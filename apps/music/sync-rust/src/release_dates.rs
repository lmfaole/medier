//! When the albums came out, asked of MusicBrainz one release group at a time (a request a second, the most played first),
//! so `release-dates <limit>` works through the backlog a few hundred requests each run and the artist pages can put an
//! album on the right month. A group's date goes to the recordings on it that have no date of their own; a group with
//! no date still gets a row, so it is not asked again. Each answer is landed unchanged under `.data/raw/musicbrainz/<date>/`.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::job::Job;
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

use crate::enrich::release_date;
use crate::scope::music_only;

const API: &str = "https://musicbrainz.org/ws/2/release-group";

const SQL_PENDING: &str = concat!(
    "SELECT recording_metadata.release_group_mbid AS id FROM listens JOIN recording_metadata USING (recording_mbid) \
     WHERE recording_metadata.release_group_mbid IS NOT NULL AND recording_metadata.release_date IS NULL \
       AND recording_metadata.release_group_mbid NOT IN (SELECT release_group_mbid FROM release_group_info WHERE dated_at IS NOT NULL) AND ",
    music_only!(),
    " GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?"
);
// A group the kind sync has not met gets its row here; one it has keeps its kinds and only gains the date.
const SQL_STORE: &str = "INSERT INTO release_group_info (release_group_mbid, primary_type, secondary_types, fetched_at, first_release_date, dated_at) \
    VALUES (?, ?, ?, ?, ?, ?) \
    ON CONFLICT (release_group_mbid) DO UPDATE SET first_release_date = excluded.first_release_date, dated_at = excluded.dated_at";
const SQL_DATE_RECORDINGS: &str = "UPDATE recording_metadata SET release_date = ? WHERE release_group_mbid = ? AND release_date IS NULL";

/// The group's first release date where MusicBrainz gives a whole year, month or day.
fn first_release_date(answer: &Value) -> Option<String> {
    release_date(answer["first-release-date"].as_str())
}

fn store(db: &SqliteClient, id: &str, answer: Option<&Value>) -> Result<()> {
    let facts = answer.map(crate::musicbrainz_extra::group_facts);
    let (primary, secondary) = facts.map_or((None, None), |facts| (facts.primary_type, facts.secondary_types));
    let date = answer.and_then(first_release_date);
    let at = now();
    db.execute(SQL_STORE, &[json!(id), json!(primary), json!(secondary), json!(at), json!(date), json!(at)])?;
    if date.is_some() {
        db.execute(SQL_DATE_RECORDINGS, &[json!(date), json!(id)])?;
    }
    Ok(())
}

/// Asks about at most `limit` release groups, the most played first. A failed request ends the run: it is asked again next time.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let ids: Vec<String> = db.query(SQL_PENDING, &[json!(limit)])?.iter().filter_map(|row| row["id"].as_str().map(str::to_string)).collect();
    let (mut asked, mut dated) = (0, 0);
    for id in ids {
        let Ok(answer) = crate::musicbrainz_extra::get(&client, &format!("{API}/{id}"), &[("fmt", "json")]).inspect_err(|error| println!("release-dates: {error:#}")) else { break };
        if let Some(answer) = &answer {
            land(&directory.join(format!("release-group-{id}.json")), answer)?;
        }
        asked += 1;
        dated += usize::from(answer.as_ref().and_then(first_release_date).is_some());
        store(db, &id, answer.as_ref())?;
    }
    println!("release-dates: {asked} asked, {dated} with a date");
    Ok(())
}

#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new("release-dates", "ask MusicBrainz when the release groups of what was heard first came out, at most <limit> requests, and give the recordings on them that date", |db, args| {
        run(db, args.positional(0).parse().context("the limit must be a number")?)
    })
    .takes(&["limit"])]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entities::test_support::TestDatabase;

    #[test]
    fn a_group_dates_the_recordings_on_it_that_have_no_date_and_keeps_its_kinds() {
        let database = TestDatabase::with(
            "INSERT INTO recording_metadata (recording_mbid, release_year, release_date, release_group_mbid, fetched_at) VALUES
               ('r1', 2018, NULL, 'g1', 0), ('r2', 2018, '2018-04-13', 'g1', 0), ('r3', 2020, NULL, 'g2', 0);
             INSERT INTO release_group_info (release_group_mbid, primary_type, fetched_at) VALUES ('g1', 'Album', 0);",
        );
        store(&database.client, "g1", Some(&json!({"first-release-date": "2018-04", "primary-type": "Single"}))).unwrap();
        store(&database.client, "g2", Some(&json!({"first-release-date": ""}))).unwrap();
        let dates = database.client.query("SELECT recording_mbid, release_date FROM recording_metadata ORDER BY recording_mbid", &[]).unwrap();
        assert_eq!(dates.iter().map(|row| row["release_date"].clone()).collect::<Vec<_>>(), vec![json!("2018-04"), json!("2018-04-13"), Value::Null]);
        let groups = database.client.query("SELECT release_group_mbid, primary_type, first_release_date, dated_at IS NOT NULL AS asked FROM release_group_info ORDER BY release_group_mbid", &[]).unwrap();
        assert_eq!((groups[0]["primary_type"].clone(), groups[0]["first_release_date"].clone()), (json!("Album"), json!("2018-04")));
        assert_eq!((groups[1]["first_release_date"].clone(), groups[1]["asked"].clone()), (Value::Null, json!(1)));
        let pending = database.client.query(SQL_PENDING, &[json!(10)]).unwrap();
        assert!(pending.is_empty(), "a dated or answered group is not asked again: {pending:?}");
    }
}
