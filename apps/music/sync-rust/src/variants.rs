//! Writes `album_variant`, `artist_variant` and `song_variant`: the album, artist and song of every spelling in
//! `listens` (`album_key.rs`, `song_key.rs`). The `canon_listens` view joins them, so this runs before the summaries.

use crate::artist_alias::{load_aliases, Aliases};
use crate::collab::{looks_joined, split};
use crate::song_key::artist_key;
use crate::album_key::{load_fasit, resolve, Spelling};
use crate::song_key::{resolve_artists, resolve_songs, ArtistSpelling, SongSpelling};
use crate::entities::{count, text};
use crate::scope::music_only;
use anyhow::Result;
use serde_json::json;
use shared_data::diff::{sync_table, Row, Table};
use shared_data::sqlite_client::SqliteClient;
use std::collections::HashSet;
use std::path::Path;

const ALBUM_VARIANT: Table = Table {
    name: "album_variant",
    columns: &["release_name", "artist_name", "album_name", "album_artist", "album_key", "release_mbid"],
    key_len: 2,
    compare_len: 6,
};

const ARTIST_VARIANT: Table = Table { name: "artist_variant", columns: &["artist_name", "artist_display", "artist_key"], key_len: 1, compare_len: 3 };
const ARTIST_ALIAS: Table = Table { name: "artist_alias", columns: &["alias_name", "canonical_name"], key_len: 1, compare_len: 2 };
const ARTIST_SPLIT: Table = Table { name: "artist_split", columns: &["artist_name", "position", "part_name"], key_len: 2, compare_len: 3 };
const SQL_CREDIT_NAMES: &str = "SELECT DISTINCT artist_name FROM recording_credit";
const SONG_VARIANT: Table = Table { name: "song_variant", columns: &["artist_name", "track_name", "song_name", "song_key"], key_len: 2, compare_len: 4 };

const SQL_ARTISTS: &str = concat!("SELECT artist_name, COUNT(*) AS plays FROM listens WHERE ", music_only!(), " GROUP BY artist_name");
const SQL_SONGS: &str = concat!("SELECT artist_name, track_name, COUNT(*) AS plays FROM listens WHERE ", music_only!(), " GROUP BY artist_name, track_name");
const SQL_SPELLINGS: &str = concat!(
    "SELECT release_name, artist_name, COUNT(*) AS plays FROM listens WHERE release_name IS NOT NULL AND ",
    music_only!(),
    " GROUP BY release_name, artist_name"
);

pub fn recompute(db: &SqliteClient, fasit: &Path, artist_file: &Path) -> Result<()> {
    let lines = load_aliases(artist_file)?;
    let desired: Vec<Row> = lines.iter().map(|line| vec![json!(line.alias), json!(line.canonical)]).collect();
    sync_table(db, &ARTIST_ALIAS, None, &desired)?;
    let aliases = Aliases::new(&lines);
    albums(db, fasit, &aliases)?;
    artists(db, &aliases)?;
    songs(db, &aliases)
}

fn artists(db: &SqliteClient, aliases: &Aliases) -> Result<()> {
    let mut spellings: Vec<ArtistSpelling> = db.query(SQL_ARTISTS, &[])?.iter().map(|row| ArtistSpelling { artist: text(&row["artist_name"]), plays: count(&row["plays"]) }).collect();
    let credited: Vec<String> = db.query(SQL_CREDIT_NAMES, &[])?.iter().map(|row| text(&row["artist_name"])).collect();
    let credited_as_one: HashSet<String> = credited.iter().map(|name| artist_key(name)).collect();
    let alone: HashSet<String> = spellings.iter().filter(|spelling| !looks_joined(&spelling.artist)).map(|spelling| artist_key(&spelling.artist)).chain(credited_as_one.iter().cloned()).collect();
    let mut splits: Vec<Row> = Vec::new();
    let mut known: HashSet<String> = spellings.iter().map(|spelling| spelling.artist.clone()).collect();
    for name in spellings.iter().map(|spelling| spelling.artist.clone()).filter(|name| looks_joined(name)).collect::<Vec<_>>() {
        for (at, part) in split(&name, &alone, &credited_as_one).into_iter().enumerate() {
            splits.push(vec![json!(name), json!(at), json!(part)]);
            if known.insert(part.clone()) {
                spellings.push(ArtistSpelling { artist: part, plays: 0 });
            }
        }
    }
    // Credited names that are never listened to on their own still need a variant row for the view to join.
    for name in credited {
        if known.insert(name.clone()) {
            spellings.push(ArtistSpelling { artist: name, plays: 0 });
        }
    }
    sync_table(db, &ARTIST_SPLIT, None, &splits)?;
    let variants = resolve_artists(&spellings, aliases);
    let desired: Vec<Row> = variants.iter().map(|variant| vec![json!(variant.artist), json!(variant.display), json!(variant.key)]).collect();
    let written = sync_table(db, &ARTIST_VARIANT, None, &desired)?;
    let artists = variants.iter().map(|variant| &variant.key).collect::<HashSet<_>>().len();
    println!("variants: {} artist spellings are {artists} artists, {} joined names split, wrote {written}", variants.len(), splits.len());
    Ok(())
}

fn songs(db: &SqliteClient, aliases: &Aliases) -> Result<()> {
    let spellings: Vec<SongSpelling> = db.query(SQL_SONGS, &[])?.iter().map(|row| SongSpelling { artist: text(&row["artist_name"]), track: text(&row["track_name"]), plays: count(&row["plays"]) }).collect();
    let variants = resolve_songs(&spellings, aliases);
    let desired: Vec<Row> = variants.iter().map(|variant| vec![json!(variant.artist), json!(variant.track), json!(variant.name), json!(variant.key)]).collect();
    let written = sync_table(db, &SONG_VARIANT, None, &desired)?;
    let songs = variants.iter().map(|variant| &variant.key).collect::<std::collections::HashSet<_>>().len();
    println!("variants: {} song spellings are {songs} songs, wrote {written}", variants.len());
    Ok(())
}

fn albums(db: &SqliteClient, fasit: &Path, aliases: &Aliases) -> Result<()> {
    let spellings: Vec<Spelling> = db
        .query(SQL_SPELLINGS, &[])?
        .iter()
        .map(|row| Spelling { album: text(&row["release_name"]), artist: text(&row["artist_name"]), plays: count(&row["plays"]) })
        .collect();
    let variants = resolve(&spellings, &load_fasit(fasit)?, aliases);
    let desired: Vec<Row> = variants
        .iter()
        .map(|variant| vec![json!(variant.album), json!(variant.artist), json!(variant.canonical_album), json!(variant.canonical_artist), json!(variant.key), json!(variant.release_mbid)])
        .collect();
    let written = sync_table(db, &ALBUM_VARIANT, None, &desired)?;
    let albums = variants.iter().map(|variant| &variant.key).collect::<std::collections::HashSet<_>>().len();
    println!("variants: {} spellings are {albums} albums, wrote {written}", variants.len());
    Ok(())
}
