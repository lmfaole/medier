//! The pages behind the sheets: one row of `entity_pages` for each of the most
//! played artists, albums and songs, with a JSON `detail` whose shape depends
//! on the kind (`entity_artists.rs`, `entity_albums.rs`, `entity_songs.rs`
//! each build their own). The Worker checks each kind's shape when it reads it.
//!
//! One table for the three kinds, with the detail as JSON, so a sheet that
//! learns a new fact needs no schema change.

use shared_data::diff::{sync_table, Row, Table};
use crate::entity_albums::albums;
use crate::entity_artists::artists;
use crate::entity_songs::songs;
use crate::slug::{slug, slug_of};
use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use std::collections::HashSet;

const ENTITY_PAGES: Table = Table {
    name: "entity_pages",
    columns: &["kind", "slug", "name", "artist_name", "cover", "play_count", "detail"],
    key_len: 2,
    compare_len: 7,
};

// Both views join every listen, and the kinds' queries read them about fifteen times. A copy in the connection's temp
// schema, which SQLite looks in before main, makes that one pass (the step went from about 50 to 20 seconds).
const SQL_SNAPSHOT: &[&str] = &[
    "CREATE TEMP TABLE canon_artist_listens AS SELECT * FROM main.canon_artist_listens",
    "CREATE INDEX temp.canon_artist_listens_artist ON canon_artist_listens (artist_name)",
    "CREATE TEMP TABLE canon_listens AS SELECT * FROM main.canon_listens",
    "CREATE INDEX temp.canon_listens_song ON canon_listens (track_name, artist_name)",
];
const SQL_DROP_SNAPSHOT: &[&str] = &["DROP TABLE IF EXISTS temp.canon_artist_listens", "DROP TABLE IF EXISTS temp.canon_listens"];

const ENTITY_ALIAS: Table =Table { name: "entity_alias", columns: &["kind", "old_slug", "slug"], key_len: 2, compare_len: 3 };

// Every spelling that was an address of its own before the spellings were joined, with the address of the name it joined.
const SQL_ARTIST_SPELLINGS: &str = "SELECT artist_name AS old_artist, artist_display AS artist FROM artist_variant WHERE artist_name <> artist_display";
const SQL_SONG_SPELLINGS: &str = "SELECT song_variant.track_name AS old_track, song_variant.artist_name AS old_artist, song_name AS track, artist_display AS artist \
     FROM song_variant JOIN artist_variant USING (artist_name)";
const SQL_ALBUM_SPELLINGS: &str = "SELECT release_name AS old_album, artist_name AS old_artist, album_name AS album, album_artist AS artist FROM album_variant";

/// One page: what the index lists, and the detail the sheet shows.
pub struct Entity {
    pub kind: &'static str,
    pub slug: String,
    pub name: String,
    /// The artist of an album or song; empty for an artist.
    pub artist_name: String,
    /// `<release>/<id>`, as `top_item_covers` has it.
    pub cover: Option<String>,
    pub play_count: i64,
    pub detail: Value,
}

impl Entity {
    fn row(&self) -> Row {
        vec![
            json!(self.kind),
            json!(self.slug),
            json!(self.name),
            json!(self.artist_name),
            json!(self.cover),
            json!(self.play_count),
            json!(self.detail.to_string()),
        ]
    }
}

pub fn recompute_entities(db: &SqliteClient) -> Result<usize> {
    for sql in SQL_DROP_SNAPSHOT.iter().chain(SQL_SNAPSHOT) {
        db.execute(sql, &[])?;
    }
    let written = write_entities(db);
    for sql in SQL_DROP_SNAPSHOT {
        db.execute(sql, &[])?;
    }
    written
}

fn write_entities(db: &SqliteClient) -> Result<usize> {
    let mut entities = artists(db)?;
    entities.extend(albums(db)?);
    entities.extend(songs(db)?);
    let desired = rows(&entities);
    let written = sync_table(db, &ENTITY_PAGES, None, &desired)?;
    println!("wrote {written} of {} entity pages, the rest were unchanged", desired.len());
    let aliases = aliases(db, &entities)?;
    let kept = sync_table(db, &ENTITY_ALIAS, None, &aliases)?;
    println!("wrote {kept} of {} old addresses that lead to a joined page", aliases.len());
    Ok(desired.len())
}

/// The old address of every joined spelling that has no page of its own, leading to the page of the name it joined.
fn aliases(db: &SqliteClient, entities: &[Entity]) -> Result<Vec<Row>> {
    let pages: HashSet<(&str, &str)> = entities.iter().map(|entity| (entity.kind, entity.slug.as_str())).collect();
    let mut pairs: Vec<(&'static str, String, String)> = Vec::new();
    for row in db.query(SQL_ARTIST_SPELLINGS, &[])? {
        pairs.push(("artist", slug(&text(&row["old_artist"])), slug(&text(&row["artist"]))));
    }
    for row in db.query(SQL_SONG_SPELLINGS, &[])? {
        pairs.push(("song", slug_of(&[&text(&row["old_track"]), &text(&row["old_artist"])]), slug_of(&[&text(&row["track"]), &text(&row["artist"])])));
    }
    for row in db.query(SQL_ALBUM_SPELLINGS, &[])? {
        pairs.push(("album", slug_of(&[&text(&row["old_album"]), &text(&row["old_artist"])]), slug_of(&[&text(&row["album"]), &text(&row["artist"])])));
    }
    let mut seen: HashSet<(&str, String)> = HashSet::new();
    let mut rows: Vec<Row> = pairs
        .into_iter()
        .filter(|(kind, old, new)| old != new && pages.contains(&(*kind, new.as_str())) && !pages.contains(&(*kind, old.as_str())))
        .filter(|(kind, old, _)| seen.insert((kind, old.clone())))
        .map(|(kind, old, new)| vec![json!(kind), json!(old), json!(new)])
        .collect();
    rows.sort_by(|a, b| (a[0].as_str(), a[1].as_str()).cmp(&(b[0].as_str(), b[1].as_str())));
    Ok(rows)
}

/// The rows of `entities`; a second entity with a slug already taken (a hash collision) is left out rather than written over the first.
fn rows(entities: &[Entity]) -> Vec<Row> {
    let mut seen: HashSet<(&str, &str)> = HashSet::new();
    entities.iter().filter(|entity| seen.insert((entity.kind, entity.slug.as_str()))).map(Entity::row).collect()
}

pub(crate) fn text(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_string()
}

pub(crate) fn count(value: &Value) -> i64 {
    value.as_i64().unwrap_or(0)
}

/// `[{year, plays}]` for a list of (year, plays), oldest first.
pub(crate) fn years_json(mut years: Vec<(i64, i64)>) -> Value {
    years.sort_unstable();
    Value::Array(years.into_iter().map(|(year, plays)| json!({ "year": year, "plays": plays })).collect())
}

/// The minutes of a sum of milliseconds.
pub(crate) fn minutes(listened_ms: &Value) -> i64 {
    count(listened_ms) / 60_000
}

#[cfg(test)]
pub(crate) mod test_support {
    use shared_data::sqlite_client::SqliteClient;

    /// A database file of its own with the real schema applied and `listens_sql` run on it; removed on drop.
    pub struct TestDatabase {
        pub client: SqliteClient,
        path: std::path::PathBuf,
    }

    impl TestDatabase {
        pub fn with(listens_sql: &str) -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
            let path = std::env::temp_dir().join(format!("music-entities-{}-{unique}.db", std::process::id()));
            let client = SqliteClient::open(&path).unwrap();
            crate::schema::apply(&client).unwrap();
            let statements = crate::schema::statements(listens_sql).into_iter().map(|sql| (sql, Vec::new())).collect::<Vec<_>>();
            client.execute_batch(&statements).unwrap();
            TestDatabase { client, path }
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(kind: &'static str, slug: &str) -> Entity {
        Entity { kind, slug: slug.into(), name: "N".into(), artist_name: String::new(), cover: None, play_count: 1, detail: json!({}) }
    }

    #[test]
    fn a_slug_taken_twice_in_a_kind_is_written_once_but_may_repeat_across_kinds() {
        let found = rows(&[entity("artist", "a"), entity("artist", "a"), entity("album", "a")]);
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn years_come_oldest_first() {
        assert_eq!(years_json(vec![(2021, 3), (2019, 5)]), json!([{ "year": 2019, "plays": 5 }, { "year": 2021, "plays": 3 }]));
    }

    #[test]
    fn an_old_address_of_a_joined_spelling_leads_to_the_page_of_the_name_it_joined() {
        let database = super::test_support::TestDatabase::with(
            "INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid) VALUES
               (1, 'Song', 'Charli xcx', 'Pop 2', NULL), (2, 'Song', 'Charli xcx', 'Pop 2', NULL), (3, 'Song', 'Charli XCX', 'Pop 2', NULL);",
        );
        crate::variants::recompute(&database.client, std::path::Path::new("/nonexistent"), std::path::Path::new("/nonexistent")).unwrap();
        recompute_entities(&database.client).unwrap();
        let found = database.client.query("SELECT kind, old_slug, slug FROM entity_alias ORDER BY kind", &[]).unwrap();
        assert_eq!(found.len(), 3);
        assert_eq!(found[0]["kind"].as_str(), Some("album"));
        assert_eq!((found[1]["kind"].as_str(), found[1]["old_slug"].as_str(), found[1]["slug"].as_str()), (Some("artist"), Some(slug("Charli XCX").as_str()), Some(slug("Charli xcx").as_str())));
        assert_eq!(found[2]["kind"].as_str(), Some("song"));
    }
}
