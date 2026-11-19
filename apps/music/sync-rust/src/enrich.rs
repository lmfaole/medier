//! Fills `recording_metadata` and `recording_genres` for every recording a
//! listen is mapped to, from ListenBrainz' MusicBrainz metadata. Only
//! recordings without a row yet are fetched, so after the first backfill a
//! sync only asks about the handful of recordings it has never seen.

use crate::listenbrainz::{self, MAX_RECORDINGS_PER_METADATA_REQUEST};
use crate::scope::music_only;
use crate::models::{MetadataTag, RecordingMetadata, RecordingMetadataResponse};
use anyhow::Result;
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

const MAX_GENRES_PER_RECORDING: usize = 3;

// Statements stay under 100 bound parameters: 8 rows * 11 columns = 88,
// and 40 rows * 2 columns = 80.

// Reads only the listens after the cursor: a recording that is asked for gets a
// row, even an empty one, so whatever was before the cursor is done. Grouped,
// so one recording heard fifty times is one row, in the order it first came up.
const SQL_PENDING_RECORDINGS: &str = concat!(
    "SELECT listens.recording_mbid AS recording_mbid, MIN(listens.rowid) AS first_row \
     FROM listens LEFT JOIN recording_metadata USING (recording_mbid) \
     WHERE listens.rowid > ? AND listens.rowid <= ? \
       AND listens.recording_mbid IS NOT NULL AND recording_metadata.recording_mbid IS NULL AND ",
    music_only!(),
    " GROUP BY listens.recording_mbid ORDER BY first_row LIMIT ?"
);
const SQL_CURSOR: &str = "SELECT last_listen_rowid FROM enrich_state WHERE id = 1";
const SQL_LISTENS_HEAD: &str = "SELECT COALESCE(MAX(rowid), 0) AS head FROM listens";
const SQL_WRITE_CURSOR: &str = "UPDATE enrich_state SET last_listen_rowid = ? WHERE id = 1";

/// The recordings to ask for now, and where the cursor stands once they are
/// stored. `rows` are (recording, first listen) ordered by first listen and
/// fetched with a limit of one more than `max`: if that extra row is there,
/// the cursor stops just before its listen, so the next run starts with it.
fn plan_pending(rows: Vec<(String, i64)>, max: usize, head: i64) -> (Vec<String>, i64) {
    match rows.get(max) {
        Some((_, first_row)) => (rows.iter().take(max).map(|(mbid, _)| mbid.clone()).collect(), first_row - 1),
        None => (rows.into_iter().map(|(mbid, _)| mbid).collect(), head),
    }
}

/// Fetches and stores metadata for at most `max_recordings` recordings of the
/// listens added since the last run, and returns how many it stored. The cap
/// keeps one scheduled run inside its time limit; a first backfill of a long
/// history is spread over several runs instead, each one picking up at the
/// cursor in `enrich_state`.
pub fn enrich_new_recordings(db: &SqliteClient, max_recordings: usize) -> Result<usize> {
    let cursor = db.query(SQL_CURSOR, &[])?.first().and_then(|row| row["last_listen_rowid"].as_i64()).unwrap_or(0);
    let head = db.query(SQL_LISTENS_HEAD, &[])?.first().and_then(|row| row["head"].as_i64()).unwrap_or(0);
    let rows: Vec<(String, i64)> = db
        .query(SQL_PENDING_RECORDINGS, &[json!(cursor), json!(head), json!(max_recordings + 1)])?
        .into_iter()
        .filter_map(|row| Some((row["recording_mbid"].as_str()?.to_string(), row["first_row"].as_i64()?)))
        .collect();
    let (pending, next_cursor) = plan_pending(rows, max_recordings, head);

    let client = listenbrainz::http_client()?;
    let fetched_at = chrono::Utc::now().timestamp();
    let mut stored = 0;
    for batch in pending.chunks(MAX_RECORDINGS_PER_METADATA_REQUEST) {
        let mut responses = listenbrainz::fetch_recording_metadata(&client, batch)?;
        let rows: Vec<RecordingMetadata> = batch
            .iter()
            .map(|mbid| to_recording_metadata(mbid, responses.remove(mbid).unwrap_or_default()))
            .collect();
        write_recording_metadata(db, &rows, fetched_at)?;
        stored += rows.len();
        println!("enriched {stored}/{} recordings", pending.len());
    }
    db.execute(SQL_WRITE_CURSOR, &[json!(next_cursor)])?;
    Ok(stored)
}

/// Flattens one metadata response into the row this crate stores. A
/// recording with no response at all still becomes a row, all `None`, so it
/// is marked as asked for.
pub fn to_recording_metadata(recording_mbid: &str, response: RecordingMetadataResponse) -> RecordingMetadata {
    let artist = response
        .artist
        .and_then(|credit| credit.artists.into_iter().next())
        .unwrap_or_default();
    let recording = response.recording.unwrap_or_default();
    let release = response.release.unwrap_or_default();
    let tags = response.tag.unwrap_or_default();

    RecordingMetadata {
        recording_mbid: recording_mbid.to_string(),
        release_year: first_release_year(recording.first_release_date.as_deref()).or(release.year),
        release_date: release_date(recording.first_release_date.as_deref()),
        length_ms: recording.length,
        artist_mbid: artist.artist_mbid,
        artist_area: artist.area,
        artist_type: artist.artist_type,
        artist_begin_year: artist.begin_year,
        release_group_mbid: release.release_group_mbid,
        caa_release_mbid: release.caa_release_mbid,
        caa_id: release.caa_id,
        genres: resolve_genres(&[&tags.recording, &tags.release_group, &tags.artist]),
    }
}

/// The year the recording first came out, which is what a "decade" chart
/// should mean. The release's own year can be a much later reissue or
/// compilation, so it is only the fallback.
fn first_release_year(first_release_date: Option<&str>) -> Option<i64> {
    first_release_date?.get(0..4)?.parse().ok()
}

/// The date as MusicBrainz gives it when it is a whole year, month or day, so a half-typed value never reaches a chart.
pub(crate) fn release_date(first_release_date: Option<&str>) -> Option<String> {
    let date = first_release_date?;
    let parts: Vec<&str> = date.split('-').collect();
    let widths = [4, 2, 2];
    let whole = (1..=3).contains(&parts.len())
        && parts.iter().zip(widths).all(|(part, width)| part.len() == width && part.bytes().all(|byte| byte.is_ascii_digit()));
    whole.then(|| date.to_string())
}

/// The top genres from the first, most specific tag level that has any
/// genre at all. Mixing levels would let an artist's broad tags drown out
/// what a particular track was actually tagged as.
pub fn resolve_genres(levels_most_specific_first: &[&Vec<MetadataTag>]) -> Vec<String> {
    for tags in levels_most_specific_first {
        let mut genres: Vec<&MetadataTag> = tags.iter().filter(|tag| tag.genre_mbid.is_some()).collect();
        if genres.is_empty() {
            continue;
        }
        genres.sort_by(|left, right| right.count.cmp(&left.count).then_with(|| left.tag.cmp(&right.tag)));
        let mut names: Vec<String> = Vec::new();
        for genre in genres {
            if !names.contains(&genre.tag) {
                names.push(genre.tag.clone());
            }
            if names.len() == MAX_GENRES_PER_RECORDING {
                break;
            }
        }
        return names;
    }
    Vec::new()
}

const METADATA_COLUMNS: &[&str] = &[
    "recording_mbid",
    "release_year",
    "release_date",
    "length_ms",
    "artist_mbid",
    "artist_area",
    "artist_type",
    "artist_begin_year",
    "release_group_mbid",
    "caa_release_mbid",
    "caa_id",
    "fetched_at",
];

fn write_recording_metadata(db: &SqliteClient, rows: &[RecordingMetadata], fetched_at: i64) -> Result<()> {
    let metadata = rows.iter().map(|row| {
        vec![
            json!(row.recording_mbid),
            json!(row.release_year),
            json!(row.release_date),
            json!(row.length_ms),
            json!(row.artist_mbid),
            json!(row.artist_area),
            json!(row.artist_type),
            json!(row.artist_begin_year),
            json!(row.release_group_mbid),
            json!(row.caa_release_mbid),
            json!(row.caa_id),
            json!(fetched_at),
        ]
    });
    let mut statements = insert_statements("INSERT OR REPLACE INTO", "recording_metadata", METADATA_COLUMNS, metadata);

    let genres = rows
        .iter()
        .flat_map(|row| row.genres.iter().map(|genre| vec![json!(row.recording_mbid), json!(genre)]));
    statements.extend(insert_statements("INSERT OR IGNORE INTO", "recording_genres", &["recording_mbid", "genre"], genres));

    db.execute_batch(&statements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{MetadataArtist, MetadataArtistCredit, MetadataRecording, MetadataRelease, MetadataTags};

    fn tag(name: &str, count: i64, is_genre: bool) -> MetadataTag {
        MetadataTag {
            tag: name.to_string(),
            count,
            genre_mbid: is_genre.then(|| "genre-mbid".to_string()),
        }
    }

    #[test]
    fn resolve_genres_uses_the_most_specific_level_that_has_a_genre() {
        let recording = vec![tag("seen live", 5, false)];
        let release_group = vec![tag("downtempo", 1, true), tag("electronic", 4, true)];
        let artist = vec![tag("house", 9, true)];
        assert_eq!(
            resolve_genres(&[&recording, &release_group, &artist]),
            vec!["electronic", "downtempo"]
        );
    }

    #[test]
    fn resolve_genres_keeps_the_three_most_counted_and_breaks_ties_by_name() {
        let tags = vec![
            tag("techno", 1, true),
            tag("ambient", 1, true),
            tag("house", 3, true),
            tag("edm", 1, true),
        ];
        assert_eq!(resolve_genres(&[&tags]), vec!["house", "ambient", "edm"]);
    }

    #[test]
    fn resolve_genres_is_empty_when_no_level_has_a_genre() {
        let tags = vec![tag("norwegian", 2, false)];
        assert_eq!(resolve_genres(&[&tags, &Vec::new()]), Vec::<String>::new());
    }

    #[test]
    fn to_recording_metadata_prefers_the_first_release_date_over_a_reissue_year() {
        let response = RecordingMetadataResponse {
            artist: Some(MetadataArtistCredit {
                artists: vec![MetadataArtist {
                    artist_mbid: Some("artist".to_string()),
                    area: Some("Norway".to_string()),
                    artist_type: Some("Group".to_string()),
                    begin_year: Some(1998),
                }],
            }),
            recording: Some(MetadataRecording {
                first_release_date: Some("2001-03-12".to_string()),
                length: Some(240_000),
            }),
            release: Some(MetadataRelease {
                year: Some(2015),
                release_group_mbid: Some("group".to_string()),
                caa_release_mbid: Some("cover".to_string()),
                caa_id: Some(42),
            }),
            tag: Some(MetadataTags {
                recording: Vec::new(),
                release_group: Vec::new(),
                artist: vec![tag("synth-pop", 2, true)],
            }),
        };

        let row = to_recording_metadata("recording", response);
        assert_eq!(row.release_year, Some(2001));
        assert_eq!(row.release_date.as_deref(), Some("2001-03-12"));
        assert_eq!(row.artist_area.as_deref(), Some("Norway"));
        assert_eq!(row.artist_type.as_deref(), Some("Group"));
        assert_eq!(row.length_ms, Some(240_000));
        assert_eq!(row.caa_id, Some(42));
        assert_eq!(row.genres, vec!["synth-pop"]);
    }

    #[test]
    fn release_date_keeps_a_whole_year_month_or_day_only() {
        assert_eq!(release_date(Some("2018-04-13")).as_deref(), Some("2018-04-13"));
        assert_eq!(release_date(Some("2018-04")).as_deref(), Some("2018-04"));
        assert_eq!(release_date(Some("2018")).as_deref(), Some("2018"));
        assert_eq!(release_date(Some("2018-4-1")), None);
        assert_eq!(release_date(Some("")), None);
        assert_eq!(release_date(None), None);
    }

    #[test]
    fn to_recording_metadata_falls_back_to_the_release_year_without_a_first_release_date() {
        let response = RecordingMetadataResponse {
            release: Some(MetadataRelease {
                year: Some(1994),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(to_recording_metadata("recording", response).release_year, Some(1994));
    }

    #[test]
    fn to_recording_metadata_marks_an_unknown_recording_with_an_empty_row() {
        let row = to_recording_metadata("unknown", RecordingMetadataResponse::default());
        assert_eq!(
            row,
            RecordingMetadata {
                recording_mbid: "unknown".to_string(),
                ..Default::default()
            }
        );
    }

    #[test]
    fn metadata_response_parses_the_real_listenbrainz_shape() {
        let body = r#"{"30d08f4c": {
            "artist": {"artist_credit_id": 1, "name": "Röyksopp", "artists": [
                {"area": "Norway", "artist_mbid": "1c70", "begin_year": 1998, "join_phrase": "",
                 "name": "Röyksopp", "rels": {}, "type": "Group"}]},
            "recording": {"first_release_date": "2022-08-19", "isrcs": [], "length": 402053,
                          "name": "Some Resolve", "rels": []},
            "release": {"album_artist_name": "Röyksopp", "caa_id": 32916450708,
                        "caa_release_mbid": "f141", "mbid": "e96c", "name": "Profound Mysteries II",
                        "release_group_mbid": "1d98", "year": 2022},
            "tag": {"artist": [{"artist_mbid": "1c70", "count": 2, "genre_mbid": "988e", "tag": "synth-pop"}],
                    "recording": [{"count": 1, "tag": "trip hop", "genre_mbid": "aaaa"}],
                    "release_group": []}
        }}"#;
        let mut parsed: std::collections::HashMap<String, RecordingMetadataResponse> =
            serde_json::from_str(body).expect("the documented shape parses");
        let row = to_recording_metadata("30d08f4c", parsed.remove("30d08f4c").unwrap());
        assert_eq!(row.release_year, Some(2022));
        assert_eq!(row.artist_type.as_deref(), Some("Group"));
        assert_eq!(row.genres, vec!["trip hop"]);
    }

    fn pending(rows: &[(&str, i64)]) -> Vec<(String, i64)> {
        rows.iter().map(|(mbid, row)| ((*mbid).to_string(), *row)).collect()
    }

    #[test]
    fn everything_that_fits_moves_the_cursor_to_the_head() {
        let (recordings, cursor) = plan_pending(pending(&[("a", 3), ("b", 7)]), 3, 20);
        assert_eq!((recordings, cursor), (vec!["a".to_string(), "b".to_string()], 20));
    }

    #[test]
    fn a_backlog_stops_the_cursor_just_before_the_first_recording_left_out() {
        let (recordings, cursor) = plan_pending(pending(&[("a", 3), ("b", 7), ("c", 9)]), 2, 20);
        assert_eq!((recordings, cursor), (vec!["a".to_string(), "b".to_string()], 8));
    }

    #[test]
    fn nothing_pending_still_moves_the_cursor_to_the_head() {
        assert_eq!(plan_pending(Vec::new(), 3, 20), (Vec::new(), 20));
    }

    #[test]
    fn the_pending_query_skips_asked_unmapped_and_earlier_listens_and_groups_repeats() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        for statement in crate::schema::statements(crate::schema::SCHEMA) {
            connection.execute(&statement, []).unwrap();
        }
        connection
            .execute_batch(
                "INSERT INTO listens (listened_at, track_name, artist_name, recording_mbid) VALUES
                   (1, 't', 'x', 'before'), (2, 't', 'x', 'asked'), (3, 't', 'x', 'new'),
                   (4, 't', 'x', NULL), (5, 't', 'x', 'new'), (6, 't', 'x', 'later');
                 INSERT INTO recording_metadata (recording_mbid, fetched_at) VALUES ('asked', 0);",
            )
            .unwrap();
        let mut statement = connection.prepare(SQL_PENDING_RECORDINGS).unwrap();
        let rows: Vec<(String, i64)> = statement
            .query_map(rusqlite::params![1, 6, 10], |row| Ok((row.get("recording_mbid")?, row.get("first_row")?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(rows, vec![("new".to_string(), 3), ("later".to_string(), 6)]);
    }
}
