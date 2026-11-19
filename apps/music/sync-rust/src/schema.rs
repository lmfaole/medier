//! The schema applied at the start of every sync; `shared_data::app_db` owns
//! how. A new table reaches production with the next scheduled sync instead of
//! waiting for someone to remember to apply it.

pub(crate) const SCHEMA: &str = include_str!("../../../../db/music.sql");

/// What the tests that build a fresh database from the real schema share.
#[cfg(test)]
pub(crate) use shared_data::sql_script::statements;

#[cfg(test)]
pub(crate) fn apply(db: &shared_data::sqlite_client::SqliteClient) -> anyhow::Result<()> {
    shared_data::app_db::apply_schema(db, SCHEMA)
}

#[cfg(test)]
/// The real schema, in SQLite ((the same engine D1 runs)), with three listens: two of
/// a mapped, enriched recording and one that ListenBrainz never mapped.
pub(crate) fn fixture_database() -> rusqlite::Connection {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    for statement in statements(SCHEMA) {
        connection.execute(&statement, []).unwrap();
    }
    connection
        .execute_batch(
            "INSERT INTO listens (listened_at, track_name, artist_name, recording_mbid, duration_ms) VALUES
               (1704067200, 'Some Resolve', 'Röyksopp', 'r1', NULL),
               (1706745600, 'Some Resolve', 'Röyksopp', 'r1', 120000),
               (1709251200, 'Unmapped', 'Someone', NULL, NULL);
             INSERT INTO recording_metadata
               (recording_mbid, release_year, length_ms, artist_mbid, artist_area, caa_release_mbid, caa_id, fetched_at)
               VALUES ('r1', 1997, 360000, 'a1', 'Norway', 'release-1', 42, 0);
             INSERT INTO recording_genres (recording_mbid, genre) VALUES ('r1', 'synth-pop'), ('r1', 'electronic');",
        )
        .unwrap();
    connection
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_real_schema_is_only_idempotent_statements() {
        assert_eq!(shared_data::app_db::unsafe_to_repeat(SCHEMA), Vec::<String>::new());
    }
}
