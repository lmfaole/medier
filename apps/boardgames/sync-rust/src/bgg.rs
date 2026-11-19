//! The register `BoardGameGeek`: the search that finds a game by title, and the game's facts (designers, year,
//! categories, description, cover) and details (players, playing time, age, ratings, weight, mechanics, publishers, every
//! link and name the register holds for it). Since the fall of 2025 every request carries a token from a registered application
//! (`BGG_TOKEN`: boardgamegeek.com/applications, free for non-commercial use, approved by hand), and the host has to be
//! `boardgamegeek.com` without `www`, or the token is ignored. BGG asks callers to go slowly.

use std::time::Duration;

use anyhow::{Context, Result};
use roxmltree::{Document, Node};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::shelf::{http, landing, now, web_address, Hit, Item, Session};
use shared_data::sqlite_client::SqliteClient;
use shared_data::text::slug;
use shared_data::tmdb::land;

const API: &str = "https://boardgamegeek.com/xmlapi2";
const PAUSE: Duration = Duration::from_millis(1500);
const DESIGNERS_KEPT: usize = 3;
const SUMMARY_LENGTH: usize = 1200;

fn attribute(node: Node, name: &str) -> Option<String> {
    node.attribute(name).map(str::trim).filter(|text| !text.is_empty()).map(str::to_string)
}

/// The text of a child element's `value` attribute, as BGG writes most facts (`<yearpublished value="1995"/>`).
fn value_of(game: Node, tag: &str) -> Option<String> {
    game.children().find(|child| child.has_tag_name(tag)).and_then(|child| attribute(child, "value"))
}

/// The hits of a search, in the order BGG ranks them; the first of equal titles wins.
fn hits_in(xml: &str) -> Result<Vec<Hit>> {
    let document = Document::parse(xml).context("reading BoardGameGeek's search answer")?;
    Ok(document
        .descendants()
        .filter(|node| node.has_tag_name("item"))
        .enumerate()
        .filter_map(|(index, item)| {
            Some(Hit {
                ext_id: attribute(item, "id")?,
                title: item.children().find(|child| child.has_tag_name("name"))
                    .and_then(|name| attribute(name, "value"))?,
                year: value_of(item, "yearpublished").and_then(|year| year.parse().ok()),
                popularity: -f64::from(u32::try_from(index).unwrap_or(u32::MAX)),
            })
        })
        .collect())
}

/// A description as BGG writes it: XML text that still holds HTML's entities and line breaks.
fn plain(text: &str) -> String {
    let decoded = text.replace("&#10;", "\n").replace("&mdash;", "—").replace("&ndash;", "–").replace("&nbsp;", " ").replace("&quot;", "\"").replace("&amp;", "&");
    let trimmed = decoded.trim();
    match trimmed.char_indices().nth(SUMMARY_LENGTH) {
        Some((end, _)) => format!("{}…", trimmed[..end].trim_end()),
        None => trimmed.to_string(),
    }
}

/// A number from a `value` attribute, or none for «Not Ranked» and the zero BGG writes for «unknown».
fn number_of<T: std::str::FromStr + Default + PartialEq>(game: Node, tag: &str) -> Option<T> {
    value_of(game, tag).and_then(|text| text.parse().ok()).filter(|number: &T| *number != T::default())
}

/// A link of the game: its register's type, number and name.
#[derive(Debug, Clone, PartialEq)]
pub struct Link {
    pub kind: String,
    pub bgg_id: String,
    pub name: String,
}

/// The votes of the player count poll for one count.
#[derive(Debug, Clone, PartialEq)]
pub struct Poll {
    pub players: String,
    pub best: i64,
    pub recommended: i64,
    pub not_recommended: i64,
}

/// A place in one of the register's lists.
#[derive(Debug, Clone, PartialEq)]
pub struct Rank {
    pub name: String,
    pub label: String,
    pub position: i64,
    pub bayes: Option<f64>,
}

/// What the register says about a game besides the facts of its `Item`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Details {
    pub thumbnail: Option<String>,
    pub min_players: Option<i64>,
    pub max_players: Option<i64>,
    pub playing_time: Option<i64>,
    pub min_playtime: Option<i64>,
    pub max_playtime: Option<i64>,
    pub min_age: Option<i64>,
    pub best_players: Option<String>,
    pub recommended_players: Option<String>,
    pub rating_average: Option<f64>,
    pub rating_bayes: Option<f64>,
    pub rating_deviation: Option<f64>,
    pub rating_count: Option<i64>,
    pub weight: Option<f64>,
    pub weight_count: Option<i64>,
    pub owned_count: Option<i64>,
    pub trading_count: Option<i64>,
    pub wanting_count: Option<i64>,
    pub wishing_count: Option<i64>,
    pub comment_count: Option<i64>,
    pub links: Vec<Link>,
    pub names: Vec<String>,
    pub polls: Vec<Poll>,
    pub ranks: Vec<Rank>,
}

/// Counts written as `2` and `4` are `2-4`; a single count is itself; a gap in the counts makes the list of ranges that remain, `2, 4-5`.
fn ranges_of(counts: &[i64]) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut start = 0;
    while start < counts.len() {
        let mut end = start;
        while end + 1 < counts.len() && counts[end + 1] == counts[end] + 1 {
            end += 1;
        }
        parts.push(if end == start { counts[start].to_string() } else { format!("{}-{}", counts[start], counts[end]) });
        start = end + 1;
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

/// The votes per player count of a `suggested_numplayers` poll. A count the box does not name (`6+`) is kept as the register writes it.
fn polls_of(game: Node) -> Vec<Poll> {
    let Some(poll) = game.children().find(|child| child.has_tag_name("poll") && child.attribute("name") == Some("suggested_numplayers")) else { return Vec::new() };
    poll.children()
        .filter(|results| results.has_tag_name("results"))
        .filter_map(|results| {
            let votes = |label: &str| results.children().find(|result| result.has_tag_name("result") && result.attribute("value") == Some(label)).and_then(|result| result.attribute("numvotes")).and_then(|count| count.parse::<i64>().ok()).unwrap_or(0);
            Some(Poll { players: attribute(results, "numplayers")?, best: votes("Best"), recommended: votes("Recommended"), not_recommended: votes("Not Recommended") })
        })
        .collect()
}

/// The counts most voters call best, and the counts most voters call at least recommended: among the counts the box names, not `6+`.
fn favoured_players(polls: &[Poll]) -> (Option<String>, Option<String>) {
    let counted: Vec<(i64, &Poll)> = polls.iter().filter_map(|poll| Some((poll.players.parse::<i64>().ok()?, poll))).collect();
    let top = counted.iter().map(|(_, poll)| poll.best).max().unwrap_or(0);
    let best: Vec<i64> = counted.iter().filter(|(_, poll)| top > 0 && poll.best == top).map(|(count, _)| *count).collect();
    let recommended: Vec<i64> = counted.iter().filter(|(_, poll)| poll.best + poll.recommended > poll.not_recommended).map(|(count, _)| *count).collect();
    (ranges_of(&best), ranges_of(&recommended))
}

/// The statistics of a `thing` answer asked for with `stats=1`: ratings, ranks and how many own, want or trade it.
fn statistics_of(game: Node, details: &mut Details) {
    let Some(ratings) = game.descendants().find(|node| node.has_tag_name("ratings")) else { return };
    details.rating_count = number_of(ratings, "usersrated");
    details.rating_average = number_of(ratings, "average");
    details.rating_bayes = number_of(ratings, "bayesaverage");
    details.rating_deviation = number_of(ratings, "stddev");
    details.owned_count = number_of(ratings, "owned");
    details.trading_count = number_of(ratings, "trading");
    details.wanting_count = number_of(ratings, "wanting");
    details.wishing_count = number_of(ratings, "wishing");
    details.comment_count = number_of(ratings, "numcomments");
    details.weight = number_of(ratings, "averageweight");
    details.weight_count = number_of(ratings, "numweights");
    details.ranks = ratings
        .descendants()
        .filter(|node| node.has_tag_name("rank"))
        .filter_map(|rank| Some(Rank { name: attribute(rank, "name")?, label: attribute(rank, "friendlyname")?, position: attribute(rank, "value")?.parse().ok()?, bayes: attribute(rank, "bayesaverage").and_then(|text| text.parse().ok()) }))
        .collect();
}

/// The game and the details of a `thing` answer, or none for a number BGG no longer has.
fn game_of(xml: &str) -> Result<Option<(Item, Details)>> {
    let document = Document::parse(xml).context("reading BoardGameGeek's answer")?;
    let Some(game) = document.descendants().find(|node| node.has_tag_name("item")) else { return Ok(None) };
    let Some(item) = item_in(game) else { return Ok(None) };
    let text_of = |tag: &str| game.children().find(|child| child.has_tag_name(tag)).and_then(|child| child.text()).map(str::trim).filter(|text| !text.is_empty());
    let polls = polls_of(game);
    let (best_players, recommended_players) = favoured_players(&polls);
    let mut details = Details {
        thumbnail: text_of("thumbnail").and_then(web_address),
        min_players: number_of(game, "minplayers"),
        max_players: number_of(game, "maxplayers"),
        playing_time: number_of(game, "playingtime"),
        min_playtime: number_of(game, "minplaytime"),
        max_playtime: number_of(game, "maxplaytime"),
        min_age: number_of(game, "minage"),
        best_players,
        recommended_players,
        links: game
            .children()
            .filter(|child| child.has_tag_name("link"))
            .filter_map(|link| Some(Link { kind: attribute(link, "type")?, bgg_id: attribute(link, "id")?, name: attribute(link, "value")? }))
            .filter(|link| link.name != "(Uncredited)")
            .collect(),
        names: game.children().filter(|child| child.has_tag_name("name") && child.attribute("type") == Some("alternate")).filter_map(|name| attribute(name, "value")).collect(),
        polls,
        ..Details::default()
    };
    statistics_of(game, &mut details);
    Ok(Some((item, details)))
}

/// The facts of the `item` element of a `thing` answer.
fn item_in(game: Node) -> Option<Item> {
    let id = attribute(game, "id")?;
    let title = game.children().filter(|child| child.has_tag_name("name")).find(|name| name.attribute("type") == Some("primary")).and_then(|name| attribute(name, "value"))?;
    let links = |kind: &str| game.children().filter(|child| child.has_tag_name("link") && child.attribute("type") == Some(kind)).filter_map(|link| attribute(link, "value")).collect::<Vec<_>>();
    let text_of = |tag: &str| game.children().find(|child| child.has_tag_name(tag)).and_then(|child| child.text()).map(str::trim).filter(|text| !text.is_empty());
    let designers: Vec<String> = links("boardgamedesigner").into_iter().filter(|name| name != "(Uncredited)").take(DESIGNERS_KEPT).collect();
    Some(Item {
        url: web_address(&format!("https://boardgamegeek.com/boardgame/{id}")),
        ext_id: id,
        title,
        creator: (!designers.is_empty()).then(|| designers.join(", ")),
        year: value_of(game, "yearpublished").and_then(|year| year.parse().ok()).filter(|year| *year != 0),
        summary: text_of("description").map(plain),
        cover: text_of("image").and_then(web_address),
        banner: None,
        genres: links("boardgamecategory"),
    })
}

struct Client {
    http: reqwest::blocking::Client,
    token: String,
}

impl Client {
    fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<String> {
        let answer = self.http.get(format!("{API}{path}")).query(query).bearer_auth(&self.token).send().and_then(reqwest::blocking::Response::error_for_status).with_context(|| format!("asking BoardGameGeek for {path}"))?.text().context("reading BoardGameGeek's answer")?;
        std::thread::sleep(PAUSE);
        Ok(answer)
    }
}

/// Stores a game's details, replacing what was stored for it.
fn save_details(db: &SqliteClient, ext_id: &str, details: &Details) -> Result<()> {
    let mut batch = vec![
        ("INSERT OR REPLACE INTO boardgame_detail (ext_id, thumbnail, min_players, max_players, playing_time, min_playtime, max_playtime, min_age, best_players, recommended_players, rating_average, rating_bayes, rating_deviation, rating_count, weight, weight_count, owned_count, trading_count, wanting_count, wishing_count, comment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)".to_string(),
            vec![json!(ext_id), json!(details.thumbnail), json!(details.min_players), json!(details.max_players), json!(details.playing_time), json!(details.min_playtime), json!(details.max_playtime), json!(details.min_age), json!(details.best_players), json!(details.recommended_players), json!(details.rating_average), json!(details.rating_bayes), json!(details.rating_deviation), json!(details.rating_count), json!(details.weight), json!(details.weight_count), json!(details.owned_count), json!(details.trading_count), json!(details.wanting_count), json!(details.wishing_count), json!(details.comment_count)]),
    ];
    for table in ["boardgame_link", "boardgame_name", "boardgame_player_poll", "boardgame_rank"] {
        batch.push((format!("DELETE FROM {table} WHERE ext_id = ?"), vec![json!(ext_id)]));
    }
    batch.extend(insert_statements("INSERT OR IGNORE INTO", "boardgame_link", &["ext_id", "kind", "bgg_id", "name"], details.links.iter().map(|link| vec![json!(ext_id), json!(link.kind), json!(link.bgg_id), json!(link.name)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", "boardgame_name", &["ext_id", "name"], details.names.iter().map(|name| vec![json!(ext_id), json!(name)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", "boardgame_player_poll", &["ext_id", "players", "best", "recommended", "not_recommended"], details.polls.iter().map(|poll| vec![json!(ext_id), json!(poll.players), json!(poll.best), json!(poll.recommended), json!(poll.not_recommended)])));
    batch.extend(insert_statements("INSERT OR IGNORE INTO", "boardgame_rank", &["ext_id", "name", "label", "position", "bayes"], details.ranks.iter().map(|rank| vec![json!(ext_id), json!(rank.name), json!(rank.label), json!(rank.position), json!(rank.bayes)])));
    db.execute_batch(&batch).with_context(|| format!("storing the details of {ext_id}"))
}

/// The games to fetch: the ones the log, the collection or a match names that are not stored, those stored with no details yet, and all of them with `everything`.
fn to_fetch(session: &Session, everything: bool) -> Result<Vec<String>> {
    let mut ids = session.shelf.to_fetch(&session.db, everything)?;
    let without_details = session.db.query("SELECT ext_id FROM boardgame_item WHERE ext_id NOT IN (SELECT ext_id FROM boardgame_detail) ORDER BY ext_id", &[])?;
    ids.extend(without_details.iter().filter_map(|row: &Value| row["ext_id"].as_str().map(str::to_string)));
    ids.sort();
    ids.dedup();
    Ok(ids)
}

pub fn run(session: &Session, everything: bool) -> Result<()> {
    let token = std::env::var("BGG_TOKEN").context("BGG_TOKEN is not set: register an application at boardgamegeek.com/applications, make a token, and put it in the environment of the job")?;
    let client = Client { http: http("boardgames-sync (lmfaole.party; hei@lmfaole.party)")?, token };
    let directory = landing("bgg")?;
    session.shelf.resolve(&session.db, |title, year| {
        let answer = client.get("/search", &[("query", title), ("type", "boardgame")])?;
        land(&directory.join(format!("search-{}-{year}.json", slug(title))), &serde_json::Value::String(answer.clone()))?;
        hits_in(&answer)
    })?;
    let ids = to_fetch(session, everything)?;
    let mut kept = 0;
    for id in &ids {
        // `stats=1` adds the ratings, ranks and counts to the answer.
        let answer = client.get("/thing", &[("id", id), ("stats", "1")])?;
        land(&directory.join(format!("{id}.json")), &serde_json::Value::String(answer.clone()))?;
        match game_of(&answer).with_context(|| format!("fetching {id}"))? {
            Some((item, details)) => {
                session.shelf.save_item(&session.db, &item, now())?;
                save_details(&session.db, &item.ext_id, &details)?;
                kept += 1;
            }
            None => println!("fetch: the register has no {id}"),
        }
    }
    println!("fetch: {kept} of {} kept", ids.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_search_gives_the_games_in_bggs_order_with_their_year() {
        let hits = hits_in(r#"<items total="2"><item type="boardgame" id="13"><name type="primary" value="Catan"/><yearpublished value="1995"/></item><item type="boardgame" id="99"><name type="alternate" value="Catan: Cities"/></item></items>"#).unwrap_or_default();
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].ext_id.as_str(), hits[0].title.as_str(), hits[0].year), ("13", "Catan", Some(1995)));
        assert!(hits[0].popularity > hits[1].popularity);
    }

    #[test]
    fn a_game_has_designers_categories_and_a_description_without_entities() {
        let (item, _) = game_of(
            r#"<items><item type="boardgame" id="13"><image>https://cf.geekdo-images.com/c.jpg</image><name type="primary" value="Catan"/><name type="alternate" value="Siedler"/>
            <description>Trade &amp;amp; build.&amp;#10;&amp;#10;Fun &amp;mdash; fast.</description><yearpublished value="1995"/>
            <link type="boardgamecategory" id="1" value="Negotiation"/><link type="boardgamedesigner" id="2" value="Klaus Teuber"/><link type="boardgamedesigner" id="3" value="(Uncredited)"/></item></items>"#,
        )
        .unwrap_or_default()
        .unwrap_or_default();
        assert_eq!((item.title.as_str(), item.creator.as_deref(), item.year, item.genres.clone()), ("Catan", Some("Klaus Teuber"), Some(1995), vec!["Negotiation".to_string()]));
        assert_eq!(item.summary.as_deref(), Some("Trade & build.\n\nFun — fast."));
        assert_eq!(item.url.as_deref(), Some("https://boardgamegeek.com/boardgame/13"));
    }

    #[test]
    fn a_number_bgg_no_longer_has_is_none_and_a_long_description_is_cut() {
        assert_eq!(game_of("<items/>").unwrap_or_default(), None);
        assert!(plain(&"word ".repeat(1000)).chars().count() <= SUMMARY_LENGTH + 1);
    }

    const CATAN: &str = r#"<items><item type="boardgame" id="13"><thumbnail>https://cf.geekdo-images.com/t.jpg</thumbnail><name type="primary" value="Catan"/><name type="alternate" value="Siedler von Catan"/>
        <yearpublished value="1995"/><minplayers value="3"/><maxplayers value="4"/><playingtime value="120"/><minplaytime value="60"/><maxplaytime value="120"/><minage value="10"/>
        <poll name="suggested_numplayers" title="User Suggested Number of Players" totalvotes="100">
          <results numplayers="2"><result value="Best" numvotes="1"/><result value="Recommended" numvotes="9"/><result value="Not Recommended" numvotes="80"/></results>
          <results numplayers="3"><result value="Best" numvotes="40"/><result value="Recommended" numvotes="50"/><result value="Not Recommended" numvotes="2"/></results>
          <results numplayers="4"><result value="Best" numvotes="60"/><result value="Recommended" numvotes="30"/><result value="Not Recommended" numvotes="1"/></results>
          <results numplayers="5"><result value="Best" numvotes="2"/><result value="Recommended" numvotes="20"/><result value="Not Recommended" numvotes="40"/></results>
          <results numplayers="5+"><result value="Best" numvotes="0"/><result value="Recommended" numvotes="1"/><result value="Not Recommended" numvotes="70"/></results>
        </poll>
        <link type="boardgamedesigner" id="2" value="Klaus Teuber"/><link type="boardgamemechanic" id="7" value="Dice Rolling"/><link type="boardgamepublisher" id="9" value="Kosmos"/><link type="boardgamedesigner" id="3" value="(Uncredited)"/>
        <statistics page="1"><ratings><usersrated value="120000"/><average value="7.1"/><bayesaverage value="6.9"/><ranks>
          <rank type="subtype" id="1" name="boardgame" friendlyname="Board Game Rank" value="450" bayesaverage="6.9"/><rank type="family" id="5" name="strategygames" friendlyname="Strategy Game Rank" value="Not Ranked" bayesaverage="Not Ranked"/></ranks>
          <stddev value="1.5"/><owned value="200000"/><trading value="900"/><wanting value="600"/><wishing value="9000"/><numcomments value="30000"/><numweights value="2000"/><averageweight value="2.3"/></ratings></statistics></item></items>"#;

    #[test]
    fn a_game_has_players_time_age_and_the_votes_of_the_player_poll() {
        let (_, details) = game_of(CATAN).unwrap_or_default().unwrap_or_default();
        assert_eq!((details.min_players, details.max_players, details.playing_time, details.min_playtime, details.max_playtime, details.min_age), (Some(3), Some(4), Some(120), Some(60), Some(120), Some(10)));
        assert_eq!((details.best_players.as_deref(), details.recommended_players.as_deref()), (Some("4"), Some("3-4")));
        assert_eq!(details.polls.len(), 5);
        assert_eq!(details.polls[4], Poll { players: "5+".into(), best: 0, recommended: 1, not_recommended: 70 });
        assert_eq!(details.thumbnail.as_deref(), Some("https://cf.geekdo-images.com/t.jpg"));
    }

    #[test]
    fn a_game_has_ratings_weight_and_only_the_ranks_it_holds() {
        let (_, details) = game_of(CATAN).unwrap_or_default().unwrap_or_default();
        assert_eq!((details.rating_average, details.rating_bayes, details.rating_count, details.weight, details.weight_count), (Some(7.1), Some(6.9), Some(120_000), Some(2.3), Some(2000)));
        assert_eq!((details.owned_count, details.wishing_count, details.comment_count), (Some(200_000), Some(9000), Some(30_000)));
        assert_eq!(details.ranks, vec![Rank { name: "boardgame".into(), label: "Board Game Rank".into(), position: 450, bayes: Some(6.9) }]);
    }

    #[test]
    fn every_link_and_other_name_is_kept_but_not_an_uncredited_designer() {
        let (_, details) = game_of(CATAN).unwrap_or_default().unwrap_or_default();
        let kinds: Vec<(&str, &str)> = details.links.iter().map(|link| (link.kind.as_str(), link.name.as_str())).collect();
        assert_eq!(kinds, vec![("boardgamedesigner", "Klaus Teuber"), ("boardgamemechanic", "Dice Rolling"), ("boardgamepublisher", "Kosmos")]);
        assert_eq!(details.names, vec!["Siedler von Catan".to_string()]);
    }

    #[test]
    fn counts_in_a_row_are_a_range_and_a_gap_starts_another() {
        assert_eq!(ranges_of(&[2, 3, 4]).as_deref(), Some("2-4"));
        assert_eq!(ranges_of(&[2, 4, 5]).as_deref(), Some("2, 4-5"));
        assert_eq!(ranges_of(&[]), None);
    }
}
