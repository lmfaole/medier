//! The line-up of a day in a city from setlist.fm (`music-sync setlist-lineup <date> <city>`): every setlist the site has for that
//! day and city names an artist, and a festival day is those artists together. The answer is kept as it came under
//! `.data/raw/setlistfm/<date>-<city>.json` (`MUSIC_SETLISTFM_RAW` names another folder) and the artists are printed, so the owner can
//! say which of them were seen and write them to `music-concert-acts.csv` (`add-concert-act`). Only what has a setlist on the site is
//! there: a small act nobody has written down is missing. The key is `SETLISTFM_API_KEY` of `music-sync.env`; the site allows two
//! requests a second, a page is twenty setlists.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use chrono::NaiveDate;
use serde_json::Value;
use shared_data::app_db::path_from_env;
use shared_data::batch::insert_statements;
use shared_data::http::client;
use shared_data::job::{Args, Job};
use shared_data::sqlite_client::SqliteClient;

const API: &str = "https://api.setlist.fm/rest/1.0/search/setlists";

/// The concerts that have been, with the day and title that name them: the log's and the calendar's.
const SQL_CONCERTS: &str = "SELECT watched_on AS day, title FROM music_concert WHERE watched_on IS NOT NULL AND watched_on <= date('now') UNION SELECT on_date, title FROM music_concert_event WHERE on_date <= date('now') ORDER BY 1";
const SQL_ACTS: &str = "SELECT artist FROM music_concert_act WHERE watched_on = ? AND title = ? ORDER BY id";
const SQL_FORGET: &str = "DELETE FROM music_concert_setlist WHERE watched_on = ? AND title = ? AND artist = ?";

/// The separators a ticket seller puts between the artist and the name of the tour or the night.
const SEPARATORS: [&str; 3] = [" - ", " – ", ": "];

/// A setlist's songs in the order played: the song, whom it is a cover of, and the encore it belongs to (0 for the main set).
#[derive(Debug, PartialEq)]
pub struct Song {
    pub name: String,
    pub cover: Option<String>,
    pub encore: i64,
}

/// The songs of a setlist of the search, in order; a song with no name (a pause in the list) is left out.
#[must_use]
pub fn songs(setlist: &Value) -> Vec<Song> {
    let sets = setlist["sets"]["set"].as_array().map(Vec::as_slice).unwrap_or_default();
    sets.iter()
        .flat_map(|set| {
            let encore = set["encore"].as_i64().unwrap_or(0);
            set["song"].as_array().into_iter().flatten().filter_map(move |song| {
                let name = song["name"].as_str().filter(|name| !name.trim().is_empty())?;
                Some(Song { name: name.trim().to_string(), cover: song["cover"]["name"].as_str().map(str::to_string), encore })
            })
        })
        .collect()
}

/// The texts of a concert's title that may be an artist's name: the whole title and each side of a separator.
#[must_use]
pub fn candidates(title: &str) -> Vec<String> {
    let mut found = vec![title.trim().to_string()];
    for separator in SEPARATORS {
        if let Some((before, after)) = title.split_once(separator) {
            found.extend([before.trim().to_string(), after.trim().to_string()]);
        }
    }
    found.retain(|text| !text.is_empty());
    found.dedup();
    found
}

/// An artist that played, as a setlist names it.
#[derive(Debug, PartialEq)]
pub struct Played {
    pub artist: String,
    pub venue: String,
    pub mbid: Option<String>,
}

/// The artists of a page of the search, in the order the site gives them.
#[must_use]
pub fn played(page: &Value) -> Vec<Played> {
    page["setlist"]
        .as_array()
        .map(|setlists| {
            setlists
                .iter()
                .filter_map(|setlist| {
                    Some(Played {
                        artist: setlist["artist"]["name"].as_str()?.to_string(),
                        venue: setlist["venue"]["name"].as_str().unwrap_or_default().to_string(),
                        mbid: setlist["artist"]["mbid"].as_str().map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The jobs of the line-ups, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![
        Job::new("setlist-songs", "keep the setlists setlist.fm has for the concerts that have been: the artists written for each, else the artist its title names", |db, _| songs_job(db)),
        Job::new("setlist-support", "list the other artists setlist.fm has at a concert's venue on its day, who may have been support; --add writes them as support: <title> <date YYYY-MM-DD>", support).takes(&["title", "date"]).flags(&["--add"]),
        Job::new("setlist-lineup", "list the artists setlist.fm has for a day in a city and keep the answer: <date YYYY-MM-DD> <city>", |_, args| lineup(args)).takes(&["date", "city"]),
    ]
}

/// The longest setlist that setlist.fm has for `artist` on `day`, as the site answered it.
fn find(http: &reqwest::blocking::Client, key: &str, artist: &str, day: NaiveDate) -> Result<Option<Value>> {
    let query = [("artistName", artist.to_string()), ("date", day.format("%d-%m-%Y").to_string()), ("p", "1".to_string())];
    for attempt in 0..3 {
        let response = http.get(API).query(&query).header("x-api-key", key).header("Accept", "application/json").send()?;
        std::thread::sleep(Duration::from_millis(600));
        match response.status() {
            reqwest::StatusCode::NOT_FOUND => return Ok(None),
            reqwest::StatusCode::TOO_MANY_REQUESTS if attempt < 2 => std::thread::sleep(Duration::from_secs(3)),
            _ => {
                let body: Value = response.error_for_status().context("asking setlist.fm")?.json()?;
                // The search matches the name loosely, and the site may hold several setlists of one night, a half-written one among them: the longest is the night's.
                let found = body["setlist"].as_array().into_iter().flatten().filter(|setlist| setlist["artist"]["name"].as_str().is_some_and(|name| name.eq_ignore_ascii_case(artist))).max_by_key(|setlist| songs(setlist).len()).filter(|setlist| !songs(setlist).is_empty());
                return Ok(found.cloned());
            }
        }
    }
    Ok(None)
}

/// The venue of a concert of the log or the calendar, by the day and title that name it.
const SQL_VENUE: &str = "SELECT place AS venue FROM music_concert WHERE watched_on = ? AND title = ? UNION SELECT venue FROM music_concert_event WHERE on_date = ? AND title = ?";

/// The artists of the venue's setlists of a day that are not already the concert's: a setlist names the venue, and an act at a venue on the
/// same day is a support act or an opener unless the venue has several stages.
fn support(db: &SqliteClient, args: &Args) -> Result<()> {
    let (title, date) = (args.positional(0), args.positional(1));
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").with_context(|| format!("«{date}» is not a date written YYYY-MM-DD"))?;
    let params = [serde_json::json!(date), serde_json::json!(title), serde_json::json!(date), serde_json::json!(title)];
    let venue_text = db.query(SQL_VENUE, &params)?.iter().find_map(|row| row["venue"].as_str().map(str::to_string)).with_context(|| format!("no concert «{title}» on {date}"))?;
    let venue = venue_text.split(',').next().unwrap_or(&venue_text).trim().to_string();
    let key = std::env::var("SETLISTFM_API_KEY").context("SETLISTFM_API_KEY is not set (music-sync.env)")?;
    let http = client("music-sync")?;
    let mut known: Vec<String> = candidates(title).iter().map(|name| name.to_lowercase()).collect();
    known.extend(db.query(SQL_ACTS, &[serde_json::json!(date), serde_json::json!(title)])?.iter().filter_map(|row| row["artist"].as_str().map(str::to_lowercase)));
    let (mut found, mut page, mut seen) = (Vec::new(), 1_u64, 0_u64);
    loop {
        let response = http.get(API).query(&[("venueName", venue.clone()), ("date", day.format("%d-%m-%Y").to_string()), ("p", page.to_string())]).header("x-api-key", &key).header("Accept", "application/json").send()?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            break;
        }
        let body: Value = response.error_for_status().context("asking setlist.fm")?.json()?;
        found.extend(played(&body).into_iter().filter(|act| act.venue.to_lowercase().contains(&venue.to_lowercase())));
        seen += body["itemsPerPage"].as_u64().unwrap_or(20).max(1);
        if seen >= body["total"].as_u64().unwrap_or(0) || page > 5 {
            break;
        }
        page += 1;
        std::thread::sleep(Duration::from_millis(600));
    }
    let others: Vec<&Played> = found.iter().filter(|act| !known.contains(&act.artist.to_lowercase())).collect();
    if others.is_empty() {
        println!("setlist-support: setlist.fm has no other artist at {venue} on {date}");
        return Ok(());
    }
    if args.flag("--add") {
        // A concert with a support act has a headliner: the artist its title names, so that the title does not turn into the support's.
        let headliner = candidates(title).get(1).cloned().unwrap_or_else(|| title.to_string());
        crate::concerts::add_act_line(db, date, title, &headliner, "headliner")?;
    }
    for act in others {
        if args.flag("--add") {
            crate::concerts::add_act_line(db, date, title, &act.artist, "support")?;
        } else {
            println!("{}\t{}", act.artist, act.venue);
        }
    }
    Ok(())
}

fn songs_job(db: &SqliteClient) -> Result<()> {
    let key = std::env::var("SETLISTFM_API_KEY").context("SETLISTFM_API_KEY is not set (music-sync.env)")?;
    let http = client("music-sync")?;
    let folder = path_from_env("MUSIC_SETLISTFM_RAW", "../../.data/raw/setlistfm").join("setlists");
    std::fs::create_dir_all(&folder).with_context(|| format!("making {}", folder.display()))?;
    let (mut concerts, mut setlists) = (0, 0);
    for concert in db.query(SQL_CONCERTS, &[])? {
        let (day_text, title) = (concert["day"].as_str().unwrap_or_default().to_string(), concert["title"].as_str().unwrap_or_default().to_string());
        let Ok(day) = NaiveDate::parse_from_str(&day_text, "%Y-%m-%d") else { continue };
        let written: Vec<String> = db.query(SQL_ACTS, &[serde_json::json!(day_text), serde_json::json!(title)])?.iter().filter_map(|row| row["artist"].as_str().map(str::to_string)).collect();
        let names = if written.is_empty() { candidates(&title) } else { written };
        concerts += 1;
        for artist in names {
            let Some(setlist) = find(&http, &key, &artist, day)? else { continue };
            let slug: String = artist.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
            std::fs::write(folder.join(format!("{day_text}-{slug}.json")), serde_json::to_string_pretty(&setlist)?).context("keeping the setlist")?;
            let url = setlist["url"].as_str().unwrap_or_default().to_string();
            let rows: Vec<Vec<Value>> = songs(&setlist)
                .iter()
                .enumerate()
                .map(|(index, song)| vec![serde_json::json!(day_text), serde_json::json!(title), serde_json::json!(artist), serde_json::json!(url), serde_json::json!(index), serde_json::json!(song.encore), serde_json::json!(song.name), serde_json::json!(song.cover)])
                .collect();
            let mut batch = vec![(SQL_FORGET.to_string(), vec![serde_json::json!(day_text), serde_json::json!(title), serde_json::json!(artist)])];
            batch.extend(insert_statements("INSERT INTO", "music_concert_setlist", &["watched_on", "title", "artist", "url", "position", "encore", "song", "cover"], rows));
            db.execute_batch(&batch).with_context(|| format!("keeping the setlist of {artist} on {day_text}"))?;
            setlists += 1;
        }
    }
    println!("setlist-songs: {setlists} setlists for {concerts} concerts");
    Ok(())
}

fn lineup(args: &Args) -> Result<()> {
    let (date, city) = (args.positional(0), args.positional(1));
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").with_context(|| format!("«{date}» is not a date written YYYY-MM-DD"))?;
    let key = std::env::var("SETLISTFM_API_KEY").context("SETLISTFM_API_KEY is not set (music-sync.env)")?;
    let http = client("music-sync")?;
    let (mut pages, mut seen, mut all) = (Vec::new(), 0_u64, Vec::new());
    for page in 1_u64.. {
        let response = http.get(API).query(&[("date", day.format("%d-%m-%Y").to_string()), ("cityName", city.to_string()), ("p", page.to_string())]).header("x-api-key", &key).header("Accept", "application/json").send()?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            break;
        }
        let body: Value = response.error_for_status().context("asking setlist.fm")?.json()?;
        let total = body["total"].as_u64().unwrap_or(0);
        let items = body["itemsPerPage"].as_u64().unwrap_or(20).max(1);
        all.extend(played(&body));
        seen += items;
        pages.push(body);
        if seen >= total || page > 20 {
            break;
        }
        std::thread::sleep(Duration::from_millis(600));
    }
    if pages.is_empty() {
        bail!("setlist.fm has no setlist for {date} in {city}");
    }
    let folder = path_from_env("MUSIC_SETLISTFM_RAW", "../../.data/raw/setlistfm");
    std::fs::create_dir_all(&folder).with_context(|| format!("making {}", folder.display()))?;
    let file = folder.join(format!("{date}-{}.json", city.to_lowercase().replace(' ', "-")));
    std::fs::write(&file, serde_json::to_string_pretty(&pages)?).with_context(|| format!("writing {}", file.display()))?;
    for act in &all {
        println!("{}\t{}", act.artist, act.venue);
    }
    println!("setlist-lineup: {} setlists for {date} in {city}, kept in {}", all.len(), file.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_songs_come_in_order_with_covers_and_encores() {
        let setlist = json!({ "sets": { "set": [
            { "song": [{ "name": "One" }, { "name": " " }, { "name": "Two", "cover": { "name": "Someone" } }] },
            { "encore": 1, "song": [{ "name": "Three" }] },
        ] } });
        assert_eq!(songs(&setlist), vec![
            Song { name: "One".into(), cover: None, encore: 0 },
            Song { name: "Two".into(), cover: Some("Someone".into()), encore: 0 },
            Song { name: "Three".into(), cover: None, encore: 1 },
        ]);
        assert!(songs(&json!({})).is_empty());
    }

    #[test]
    fn a_title_may_name_the_artist_on_either_side_of_a_separator() {
        assert_eq!(candidates("Zara Larsson - Midnight Sun 2025 Tour"), ["Zara Larsson - Midnight Sun 2025 Tour", "Zara Larsson", "Midnight Sun 2025 Tour"]);
        assert_eq!(candidates("GIMS"), ["GIMS"]);
    }

    #[test]
    fn a_page_names_the_artist_and_the_venue_of_each_setlist() {
        let page = json!({ "setlist": [
            { "artist": { "name": "Sigrid", "mbid": "7318" }, "venue": { "name": "Slottsfjell" } },
            { "artist": { "name": "Alma" }, "venue": {} },
            { "venue": { "name": "no artist" } },
        ] });
        assert_eq!(
            played(&page),
            vec![
                Played { artist: "Sigrid".into(), venue: "Slottsfjell".into(), mbid: Some("7318".into()) },
                Played { artist: "Alma".into(), venue: String::new(), mbid: None },
            ]
        );
        assert!(played(&json!({})).is_empty());
    }
}
