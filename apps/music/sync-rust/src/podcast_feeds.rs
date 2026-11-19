//! What the podcasts are. For each show with a few plays this finds it in Apple's podcast directory (no key
//! needed), lands the directory's answer and the show's own RSS feed unchanged under
//! `.data/raw/podcast-feeds/<date>/`, and writes what the feed says (the show, its episodes, the people it
//! names) to `podcasts.db`. Idempotent: a run replaces a show's rows with what its feed says now.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::normalize;

use crate::slug::slug;

/// A show with fewer plays than this is a clip or a one-off, and not worth a lookup.
const MIN_PLAYS: i64 = 3;
/// Apple's storefronts a show is looked for in, in order: the owner's own first.
const STOREFRONTS: [&str; 3] = ["no", "us", "gb"];
/// Descriptions are kept to this many characters; the landed feed has the whole text.
const DESCRIPTION_LIMIT: usize = 2000;
/// Pause between two shows, for the directory's rate limit and the feeds' hosts.
const PAUSE: Duration = Duration::from_millis(1500);

const ITUNES_NAMESPACE: &str = "http://www.itunes.com/dtds/podcast-1.0.dtd";
const PODCAST_NAMESPACE: &str = "https://podcastindex.org/namespace/1.0";

const SQL_SHOWS: &str = "SELECT show_name FROM podcast_plays WHERE ms_played >= 60000 GROUP BY show_name HAVING COUNT(*) >= ? \
    UNION SELECT artist_name FROM podcast_shows";
const SQL_TRIED: &str = "SELECT show_name FROM podcast_lookup";
/// The feeds chosen by hand that are not the ones stored yet; a choice of no feed (empty) is a show to leave alone.
const SQL_CHOICES: &str = "SELECT choice.show_name AS show_name, choice.feed_url AS feed_url FROM podcast_feed_choice AS choice \
    LEFT JOIN podcast_show_info AS info USING (show_name) WHERE info.feed_url IS NOT choice.feed_url";
const SQL_NO_FEED: &str = "SELECT show_name FROM podcast_feed_choice WHERE feed_url = ''";

const SHOW_COLUMNS: [&str; 14] = [
    "show_name", "itunes_id", "feed_url", "title", "author", "owner_name", "language", "itunes_country", "genre", "description", "website",
    "image_url", "apple_url", "fetched_at",
];
const EPISODE_COLUMNS: [&str; 9] = ["show_name", "guid", "title", "description", "published_at", "duration_s", "link", "season", "episode"];
const PERSON_COLUMNS: [&str; 5] = ["show_name", "episode_guid", "name", "role", "href"];

/// What Apple's directory knows of one show.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub id: i64,
    pub title: String,
    pub feed_url: String,
    pub genre: String,
    pub image: String,
    pub apple_url: String,
    pub country: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    pub name: String,
    pub role: String,
    pub href: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedEpisode {
    pub guid: String,
    pub title: String,
    pub description: String,
    pub published_at: Option<i64>,
    pub duration_s: Option<i64>,
    pub link: Option<String>,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub people: Vec<Person>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Feed {
    pub title: String,
    pub description: String,
    pub author: String,
    pub owner: String,
    pub language: String,
    pub website: String,
    pub image: String,
    pub genre: String,
    pub people: Vec<Person>,
    pub episodes: Vec<FeedEpisode>,
}

/// The hit whose title is the show's name, ignoring case, accents and punctuation; no guess otherwise.
#[must_use]
pub fn pick(hits: Vec<Hit>, show: &str) -> Option<Hit> {
    let wanted = normalize(show);
    hits.into_iter().find(|hit| normalize(&hit.title) == wanted && !hit.feed_url.is_empty())
}

fn hits_in(answer: &Value) -> Vec<Hit> {
    let text = |result: &Value, key: &str| result[key].as_str().unwrap_or_default().to_string();
    answer["results"]
        .as_array()
        .map(|results| {
            results
                .iter()
                .map(|result| Hit {
                    id: result["collectionId"].as_i64().unwrap_or_default(),
                    title: text(result, "collectionName"),
                    feed_url: text(result, "feedUrl"),
                    genre: text(result, "primaryGenreName"),
                    image: text(result, "artworkUrl600"),
                    apple_url: text(result, "collectionViewUrl"),
                    country: text(result, "country"),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A feed's HTML or text as plain text: tags gone, the common entities decoded, white space collapsed, cut at the limit.
#[must_use]
pub fn plain_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' if in_tag => in_tag = false,
            _ if in_tag => {}
            _ => text.push(c),
        }
    }
    let decoded = text
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(DESCRIPTION_LIMIT).collect()
}

/// «1:02:03», «12:30» and «750» as seconds.
#[must_use]
pub fn duration_seconds(text: &str) -> Option<i64> {
    let mut seconds = 0_i64;
    for part in text.trim().split(':') {
        seconds = seconds.checked_mul(60)?.checked_add(part.trim().split('.').next()?.parse::<i64>().ok()?)?;
    }
    (seconds > 0).then_some(seconds)
}

fn child<'a>(node: roxmltree::Node<'a, 'a>, name: &str, namespace: Option<&str>) -> Option<roxmltree::Node<'a, 'a>> {
    node.children().find(|candidate| candidate.is_element() && candidate.tag_name().name() == name && candidate.tag_name().namespace() == namespace)
}

fn text_of(node: roxmltree::Node<'_, '_>, name: &str, namespace: Option<&str>) -> String {
    child(node, name, namespace).and_then(|found| found.text()).unwrap_or_default().trim().to_string()
}

fn people_of(node: roxmltree::Node<'_, '_>) -> Vec<Person> {
    node.children()
        .filter(|candidate| candidate.is_element() && candidate.tag_name().name() == "person" && candidate.tag_name().namespace() == Some(PODCAST_NAMESPACE))
        .filter_map(|person| {
            let name = person.text()?.trim().to_string();
            (!name.is_empty()).then(|| Person {
                name,
                role: person.attribute("role").unwrap_or_default().trim().to_lowercase(),
                href: person.attribute("href").map(str::to_string),
            })
        })
        .collect()
}

fn description_of(node: roxmltree::Node<'_, '_>) -> String {
    for (name, namespace) in [("description", None), ("summary", Some(ITUNES_NAMESPACE)), ("encoded", Some("http://purl.org/rss/1.0/modules/content/"))] {
        let text = plain_text(&text_of(node, name, namespace));
        if !text.is_empty() {
            return text;
        }
    }
    String::new()
}

fn image_of(node: roxmltree::Node<'_, '_>) -> String {
    child(node, "image", Some(ITUNES_NAMESPACE))
        .and_then(|image| image.attribute("href"))
        .map(str::to_string)
        .or_else(|| child(node, "image", None).map(|image| text_of(image, "url", None)).filter(|url| !url.is_empty()))
        .unwrap_or_default()
}

/// Reads an RSS feed: the show and its episodes, with the people the feed names.
pub fn parse_feed(xml: &str) -> Result<Feed> {
    let document = roxmltree::Document::parse_with_options(xml, roxmltree::ParsingOptions { allow_dtd: true, ..Default::default() }).context("reading the feed as XML")?;
    let channel = document.descendants().find(|node| node.is_element() && node.tag_name().name() == "channel").context("the feed has no channel")?;
    let owner = child(channel, "owner", Some(ITUNES_NAMESPACE)).map(|owner| text_of(owner, "name", Some(ITUNES_NAMESPACE))).unwrap_or_default();
    let mut feed = Feed {
        title: text_of(channel, "title", None),
        description: description_of(channel),
        author: text_of(channel, "author", Some(ITUNES_NAMESPACE)),
        owner,
        language: text_of(channel, "language", None),
        website: text_of(channel, "link", None),
        image: image_of(channel),
        genre: child(channel, "category", Some(ITUNES_NAMESPACE)).and_then(|category| category.attribute("text")).unwrap_or_default().to_string(),
        people: people_of(channel),
        episodes: Vec::new(),
    };
    for item in channel.children().filter(|node| node.is_element() && node.tag_name().name() == "item") {
        let title = text_of(item, "title", None);
        let link = text_of(item, "link", None);
        let guid = Some(text_of(item, "guid", None)).filter(|guid| !guid.is_empty()).or_else(|| Some(link.clone()).filter(|link| !link.is_empty())).unwrap_or_else(|| title.clone());
        if title.is_empty() {
            continue;
        }
        let number = |name: &str| text_of(item, name, Some(ITUNES_NAMESPACE)).parse::<i64>().ok();
        feed.episodes.push(FeedEpisode {
            guid,
            title,
            description: description_of(item),
            published_at: chrono::DateTime::parse_from_rfc2822(&text_of(item, "pubDate", None)).ok().map(|date| date.timestamp()),
            duration_s: duration_seconds(&text_of(item, "duration", Some(ITUNES_NAMESPACE))),
            link: Some(link).filter(|link| !link.is_empty()),
            season: number("season"),
            episode: number("episode"),
            people: people_of(item),
        });
    }
    Ok(feed)
}

fn optional(text: &str) -> Value {
    if text.is_empty() {
        Value::Null
    } else {
        json!(text)
    }
}

/// Replaces everything stored about `show` with what its feed and the directory say.
pub fn store(db: &SqliteClient, show: &str, hit: &Hit, feed: &Feed, now: i64) -> Result<()> {
    let mut batch: Vec<(String, Vec<Value>)> = ["podcast_feed_episode", "podcast_person", "podcast_show_info"]
        .iter()
        .map(|table| (format!("DELETE FROM {table} WHERE show_name = ?"), vec![json!(show)]))
        .collect();
    let title = if feed.title.is_empty() { hit.title.as_str() } else { feed.title.as_str() };
    batch.extend(insert_statements(
        "INSERT INTO",
        "podcast_show_info",
        &SHOW_COLUMNS,
        [vec![
            json!(show),
            if hit.id == 0 { Value::Null } else { json!(hit.id) },
            optional(&hit.feed_url),
            json!(title),
            optional(&feed.author),
            optional(&feed.owner),
            optional(&feed.language),
            optional(&hit.country),
            optional(if hit.genre.is_empty() { &feed.genre } else { &hit.genre }),
            optional(&feed.description),
            optional(&feed.website),
            optional(if hit.image.is_empty() { &feed.image } else { &hit.image }),
            optional(&hit.apple_url),
            json!(now),
        ]],
    ));
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "podcast_feed_episode",
        &EPISODE_COLUMNS,
        feed.episodes.iter().map(|episode| {
            vec![
                json!(show),
                json!(episode.guid),
                json!(episode.title),
                optional(&episode.description),
                json!(episode.published_at),
                json!(episode.duration_s),
                json!(episode.link),
                json!(episode.season),
                json!(episode.episode),
            ]
        }),
    ));
    let people = feed
        .people
        .iter()
        .map(|person| ("", person))
        .chain(feed.episodes.iter().flat_map(|episode| episode.people.iter().map(|person| (episode.guid.as_str(), person))));
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "podcast_person",
        &PERSON_COLUMNS,
        people.map(|(guid, person)| vec![json!(show), json!(guid), json!(person.name), json!(person.role), json!(person.href)]),
    ));
    batch.push(("INSERT OR REPLACE INTO podcast_lookup (show_name, tried_at, found) VALUES (?, ?, 1)".to_string(), vec![json!(show), json!(now)]));
    db.execute_batch(&batch).with_context(|| format!("writing what the feed of {show} says"))
}

fn search(client: &reqwest::blocking::Client, show: &str, directory: &Path) -> Result<Option<(Hit, Value)>> {
    for storefront in STOREFRONTS {
        let answer: Value = client
            .get("https://itunes.apple.com/search")
            .query(&[("media", "podcast"), ("entity", "podcast"), ("limit", "10"), ("country", storefront), ("term", show)])
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .with_context(|| format!("asking Apple's directory for {show}"))?
            .json()
            .context("reading Apple's answer")?;
        if let Some(hit) = pick(hits_in(&answer), show) {
            land(&directory.join(format!("{}.itunes.json", slug(show))), &serde_json::to_string_pretty(&answer)?)?;
            return Ok(Some((hit, answer)));
        }
        std::thread::sleep(PAUSE);
    }
    Ok(None)
}

/// Saves an original unchanged, once: a file already landed (an interrupted run resumed) is left as it is.
fn land(path: &Path, content: &str) -> Result<()> {
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, content).with_context(|| format!("landing {}", path.display()))
}

/// The feed that was chosen by hand for `show`, standing for what the directory would have said.
fn chosen(feed_url: &str) -> Hit {
    Hit { id: 0, title: String::new(), feed_url: feed_url.to_string(), genre: String::new(), image: String::new(), apple_url: String::new(), country: String::new() }
}

fn lookup(db: &SqliteClient, client: &reqwest::blocking::Client, show: &str, choice: Option<&str>, directory: &Path, now: i64) -> Result<bool> {
    let hit = if let Some(feed_url) = choice {
        chosen(feed_url)
    } else if let Some((hit, _)) = search(client, show, directory)? {
        hit
    } else {
        db.execute("INSERT OR REPLACE INTO podcast_lookup (show_name, tried_at, found) VALUES (?, ?, 0)", &[json!(show), json!(now)])?;
        return Ok(false);
    };
    let path = directory.join(format!("{}.{}rss.xml", slug(show), if choice.is_some() { "choice." } else { "" }));
    if !path.exists() {
        let body = client
            .get(&hit.feed_url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .with_context(|| format!("fetching the feed of {show}"))?
            .bytes()
            .context("reading the feed")?;
        land(&path, &String::from_utf8_lossy(&body))?;
    }
    let xml = std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    store(db, show, &hit, &parse_feed(&xml)?, now)?;
    Ok(true)
}

/// The `podcast-feeds` job: the shows not yet looked for (every show with `refresh`).
pub fn run(db: &SqliteClient, refresh: bool) -> Result<()> {
    let mut shows: BTreeSet<String> = BTreeSet::new();
    for row in db.query(SQL_SHOWS, &[json!(MIN_PLAYS)])? {
        if let Some(name) = row["show_name"].as_str().or_else(|| row["artist_name"].as_str()) {
            shows.insert(name.to_string());
        }
    }
    if !refresh {
        for row in db.query(SQL_TRIED, &[])? {
            if let Some(name) = row["show_name"].as_str() {
                shows.remove(name);
            }
        }
    }
    let mut choices: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for row in db.query(SQL_CHOICES, &[])? {
        if let (Some(name), Some(feed)) = (row["show_name"].as_str(), row["feed_url"].as_str()) {
            if !feed.is_empty() {
                shows.insert(name.to_string());
                choices.insert(name.to_string(), feed.to_string());
            }
        }
    }
    for row in db.query(SQL_NO_FEED, &[])? {
        if let Some(name) = row["show_name"].as_str() {
            shows.remove(name);
        }
    }
    let directory = shared_data::raw::landing_path("podcast-feeds", chrono::Utc::now().date_naive())?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let client = crate::listenbrainz::http_client()?;
    let now = chrono::Utc::now().timestamp();
    let (mut found, mut missing, mut failed) = (0, 0, 0);
    for show in &shows {
        match lookup(db, &client, show, choices.get(show).map(String::as_str), &directory, now) {
            Ok(true) => found += 1,
            Ok(false) => missing += 1,
            Err(error) => {
                failed += 1;
                eprintln!("{show}: {error:#}");
            }
        }
        std::thread::sleep(PAUSE);
    }
    println!("podcast-feeds: {found} shows found, {missing} not in Apple's directory, {failed} failed (tried again next run), of {} looked for", shows.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Debatten</title>
  <link>https://example.org/debatten</link>
  <language>nb</language>
  <description>&lt;p&gt;Ukens &amp;amp; m&#229;nedens debatt.&lt;/p&gt;</description>
  <itunes:author>NRK</itunes:author>
  <itunes:owner><itunes:name>NRK Radio</itunes:name></itunes:owner>
  <itunes:image href="https://example.org/cover.jpg"/>
  <itunes:category text="News"/>
  <podcast:person role="Host" href="https://example.org/ola">Ola Nordmann</podcast:person>
  <item>
    <title>Episode One</title>
    <guid isPermaLink="false">abc-1</guid>
    <link>https://example.org/1</link>
    <pubDate>Tue, 06 Oct 2026 10:00:00 +0000</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <itunes:season>2</itunes:season>
    <itunes:episode>7</itunes:episode>
    <description><![CDATA[<p>About <b>one</b>&nbsp;thing.</p>]]></description>
    <podcast:person role="guest">Kari Hansen</podcast:person>
  </item>
  <item><title>No guid</title><link>https://example.org/2</link><itunes:summary>Summary only</itunes:summary></item>
  <item><description>No title, left out</description></item>
</channel></rss>"#;

    fn db() -> SqliteClient {
        let db = SqliteClient::open(Path::new(":memory:")).unwrap_or_else(|error| panic!("{error}"));
        shared_data::app_db::apply_schema(&db, crate::podcasts::SCHEMA).unwrap_or_else(|error| panic!("{error}"));
        db
    }

    fn hit() -> Hit {
        Hit { id: 7, title: "Debatten".into(), feed_url: "https://example.org/feed".into(), genre: "News".into(), image: String::new(), apple_url: "https://apple/7".into(), country: "NOR".into() }
    }

    #[test]
    fn only_a_hit_with_the_shows_own_title_and_a_feed_is_picked() {
        let other = Hit { title: "Debatten Extra".into(), ..hit() };
        let no_feed = Hit { feed_url: String::new(), ..hit() };
        assert_eq!(pick(vec![other.clone(), hit()], "debatten"), Some(hit()));
        assert_eq!(pick(vec![other, no_feed], "Debatten"), None);
    }

    #[test]
    fn html_becomes_text_and_durations_become_seconds() {
        assert_eq!(plain_text("<p>One&nbsp;&amp; <b>two</b></p>\n<p>three</p>"), "One & two three");
        assert_eq!(plain_text(&"x".repeat(3000)).chars().count(), DESCRIPTION_LIMIT);
        assert_eq!([duration_seconds("1:02:03"), duration_seconds("12:30"), duration_seconds("750"), duration_seconds("0"), duration_seconds("soon")], [Some(3723), Some(750), Some(750), None, None]);
    }

    #[test]
    fn a_feed_gives_the_show_its_episodes_and_the_people_it_names() {
        let feed = parse_feed(FEED).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!((feed.title.as_str(), feed.author.as_str(), feed.owner.as_str(), feed.language.as_str(), feed.genre.as_str()), ("Debatten", "NRK", "NRK Radio", "nb", "News"));
        assert_eq!(feed.description, "Ukens & måneden debatt.".replace("måneden", "månedens"));
        assert_eq!(feed.image, "https://example.org/cover.jpg");
        assert_eq!(feed.people, vec![Person { name: "Ola Nordmann".into(), role: "host".into(), href: Some("https://example.org/ola".into()) }]);
        assert_eq!(feed.episodes.len(), 2);
        let first = &feed.episodes[0];
        assert_eq!((first.guid.as_str(), first.description.as_str(), first.duration_s, first.season, first.episode), ("abc-1", "About one thing.", Some(3723), Some(2), Some(7)));
        assert_eq!(first.published_at, Some(1_791_280_800));
        assert_eq!(first.people[0].name, "Kari Hansen");
        // No guid: the link stands for it. No title: no episode. A summary stands for a missing description.
        assert_eq!((feed.episodes[1].guid.as_str(), feed.episodes[1].description.as_str()), ("https://example.org/2", "Summary only"));
    }

    #[test]
    fn storing_twice_leaves_one_copy_and_replaces_what_the_feed_no_longer_has() {
        let db = db();
        let feed = parse_feed(FEED).unwrap_or_else(|error| panic!("{error:#}"));
        store(&db, "Debatten", &hit(), &feed, 100).unwrap_or_else(|error| panic!("{error:#}"));
        store(&db, "Debatten", &hit(), &feed, 200).unwrap_or_else(|error| panic!("{error:#}"));
        let count = |table: &str| db.query(&format!("SELECT count(*) AS n FROM {table}"), &[]).unwrap_or_default()[0]["n"].as_i64();
        assert_eq!([count("podcast_show_info"), count("podcast_feed_episode"), count("podcast_person"), count("podcast_lookup")], [Some(1), Some(2), Some(2), Some(1)]);
        let shorter = Feed { episodes: feed.episodes[..1].to_vec(), ..feed };
        store(&db, "Debatten", &hit(), &shorter, 300).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(count("podcast_feed_episode"), Some(1));
        let info = db.query("SELECT fetched_at, itunes_country, description FROM podcast_show_info", &[]).unwrap_or_default();
        assert_eq!((info[0]["fetched_at"].as_i64(), info[0]["itunes_country"].as_str()), (Some(300), Some("NOR")));
    }

    #[test]
    fn a_chosen_feed_is_looked_at_until_it_is_the_one_stored() {
        let db = db();
        let feed = parse_feed(FEED).unwrap_or_else(|error| panic!("{error:#}"));
        store(&db, "Debatten", &hit(), &feed, 100).unwrap_or_else(|error| panic!("{error:#}"));
        db.execute("INSERT INTO podcast_feed_choice (show_name, feed_url) VALUES ('Debatten', 'https://example.org/feed'), ('Other', 'https://example.org/other'), ('None', '')", &[])
            .unwrap_or_else(|error| panic!("{error:#}"));
        let rows = db.query(SQL_CHOICES, &[]).unwrap_or_default();
        let mut names: Vec<&str> = rows.iter().filter_map(|row| row["show_name"].as_str()).collect();
        names.sort_unstable();
        // Debatten already has the chosen feed; Other has none stored; None is a choice of no feed, which `run` leaves out itself.
        assert_eq!(names, vec!["None", "Other"]);
    }
}
