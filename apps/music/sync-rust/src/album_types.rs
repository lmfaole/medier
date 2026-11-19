//! What kind of release each album an artist was heard on is, asked of MusicBrainz by artist and album name (one request a second, the most
//! played first): a release group whose title is the album's (the search's score is 90 or more) tells `Album`, `Single`, `EP` and the secondary
//! types. The recording's own release group says too little (it is the album a single is on). Each answer is landed unchanged under
//! `.data/raw/musicbrainz/<date>/`. An album that is asked about has a row, with no type where there is no such release group.

use crate::musicbrainz_extra::get;
use crate::scope::music_only;
use anyhow::Result;
use serde_json::{json, Value};
use anyhow::Context;
use shared_data::job::Job;
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

const API: &str = "https://musicbrainz.org/ws/2/release-group";
const PROFILED_ARTISTS: i64 = 300;

// The most played artists, one JSON array of their names for the next query, which is how `entity_artists.rs` limits its queries too.
const SQL_ARTISTS: &str = concat!("SELECT artist_name FROM canon_artist_listens AS listens WHERE ", music_only!(), " GROUP BY artist_name ORDER BY COUNT(*) DESC LIMIT ?");
// The albums of those artists that were heard in at least two tracks, the most played first.
const SQL_ALBUMS: &str = concat!(
    "SELECT listens.artist_name, listens.release_name, COUNT(*) AS plays FROM canon_artist_listens AS listens \
     WHERE listens.release_name IS NOT NULL AND listens.artist_name IN (SELECT value FROM json_each(?)) AND ",
    music_only!(),
    " GROUP BY listens.artist_name, listens.release_name HAVING COUNT(DISTINCT track_name) >= 2 ORDER BY plays DESC"
);
const SQL_ASKED: &str = "SELECT artist_name, release_name FROM album_type";

/// Letters and digits only, lowercase: «BRAT» and «Brat» are one title, «Boys - Single» is not «Boys».
fn plain(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// A MusicBrainz query value in quotes, so a quote or a backslash in a title cannot end it.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "").replace('"', "\\\""))
}

/// The title without an edition in its end: «B'Day (Deluxe Edition)» is «B'Day», «Crash [Deluxe]» is «Crash».
fn without_edition(album: &str) -> &str {
    let cut = album.rfind(['(', '[']).filter(|at| album.ends_with([')', ']']) && *at > 0).unwrap_or(album.len());
    album[..cut].trim_end()
}

/// The release group of a search that is the album: its title is the album's, or the album's without its edition, and the score leaves little doubt; the first such.
#[must_use]
pub fn group_of<'a>(answer: &'a Value, album: &str) -> Option<&'a Value> {
    let groups = answer["release-groups"].as_array()?;
    let sure = || groups.iter().filter(|group| group["score"].as_i64().unwrap_or_default() >= 90);
    sure().find(|group| group["title"].as_str().is_some_and(|title| plain(title) == plain(album))).or_else(|| sure().find(|group| group["title"].as_str().is_some_and(|title| plain(title) == plain(without_edition(album)))))
}

/// The secondary types of a release group, comma-separated, or none.
#[must_use]
pub fn secondary_of(group: &Value) -> Option<String> {
    let types: Vec<&str> = group["secondary-types"].as_array()?.iter().filter_map(Value::as_str).collect();
    (!types.is_empty()).then(|| types.join(","))
}

/// The answer of a search for the release group `title` by `artist`: the one landed already today, else MusicBrainz's, which is landed.
fn answer_for(client: &reqwest::blocking::Client, directory: &std::path::Path, artist: &str, title: &str) -> Result<Option<Value>> {
    let file = directory.join(format!("album-type-{}.json", shared_data::text::slug(&format!("{artist} {title}"))));
    if let Some(answer) = std::fs::read_to_string(&file).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()) {
        return Ok(Some(answer));
    }
    let query = format!("releasegroup:{} AND artist:{}", quoted(title), quoted(artist));
    let Some(answer) = get(client, API, &[("query", &query), ("limit", "10"), ("fmt", "json")])? else { return Ok(None) };
    land(&file, &answer)?;
    Ok(Some(answer))
}

/// The jobs of the album types, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new("album-types", "ask MusicBrainz what kind of release (album, single, EP) the most played albums of the most played artists are, at most <limit> requests", |db, args| {
        run(db, args.positional(0).parse().context("the limit must be a number")?)
    })
    .takes(&["limit"])]
}

/// At most `limit` albums are asked about.
fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let (mut asked, mut typed) = (0, 0);
    let artists: Vec<Value> = db.query(SQL_ARTISTS, &[json!(PROFILED_ARTISTS)])?.iter().map(|row| row["artist_name"].clone()).collect();
    let asked_before: std::collections::HashSet<(String, String)> = db.query(SQL_ASKED, &[])?.iter().map(|row| (crate::entities::text(&row["artist_name"]), crate::entities::text(&row["release_name"]))).collect();
    let pending = db.query(SQL_ALBUMS, &[json!(Value::Array(artists).to_string())])?;
    let pending = pending.iter().filter(|row| !asked_before.contains(&(crate::entities::text(&row["artist_name"]), crate::entities::text(&row["release_name"])))).take(limit);
    for row in pending {
        let (artist, album) = (crate::entities::text(&row["artist_name"]), crate::entities::text(&row["release_name"]));
        // The album's own title first, then its title without an edition («B'Day (Deluxe Edition)» is MusicBrainz's «B'Day»).
        let stripped = without_edition(&album);
        let titles: &[&str] = if stripped.is_empty() || stripped == album { &[album.as_str()] } else { &[album.as_str(), stripped] };
        let mut group = None;
        for title in titles {
            if let Some(answer) = answer_for(&client, &directory, &artist, title)? {
                group = group_of(&answer, &album).cloned();
            }
            if group.is_some() {
                break;
            }
        }
        let group = group.as_ref();
        typed += usize::from(group.is_some());
        asked += 1;
        db.execute(
            "INSERT INTO album_type (artist_name, release_name, primary_type, secondary_types, release_group_mbid, fetched_at) VALUES (?, ?, ?, ?, ?, ?) \
             ON CONFLICT(artist_name, release_name) DO UPDATE SET primary_type = excluded.primary_type, secondary_types = excluded.secondary_types, release_group_mbid = excluded.release_group_mbid, fetched_at = excluded.fetched_at",
            &[json!(artist), json!(album), json!(group.and_then(|group| group["primary-type"].as_str())), json!(group.and_then(secondary_of)), json!(group.and_then(|group| group["id"].as_str())), json!(now())],
        )?;
    }
    println!("album-types: {asked} albums asked about, {typed} typed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_search_names_the_group_only_for_the_albums_own_title_with_a_sure_score() {
        let answer = json!({ "release-groups": [
            { "id": "g1", "title": "Boys - Single", "score": 100, "primary-type": "Single" },
            { "id": "g2", "title": "BRAT", "score": 100, "primary-type": "Album", "secondary-types": ["Remix", "Live"] },
            { "id": "g3", "title": "Brat", "score": 70, "primary-type": "Album" },
        ] });
        assert_eq!(group_of(&answer, "Brat").map(|group| group["id"].clone()), Some(json!("g2")));
        assert_eq!(group_of(&answer, "Brat").and_then(secondary_of), Some("Remix,Live".to_string()));
        assert!(group_of(&answer, "Boys").is_none());
        // An edition's name finds the album itself, but not a single that happens to share the words.
        assert_eq!(group_of(&answer, "BRAT (Deluxe Edition)").map(|group| group["id"].clone()), Some(json!("g2")));
        assert_eq!(without_edition("Crash [Deluxe]"), "Crash");
        assert_eq!(without_edition("Pop 2"), "Pop 2");
    }
}
