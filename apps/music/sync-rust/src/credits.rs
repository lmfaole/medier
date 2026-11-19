//! Who is credited on a recording. A listen carries one string ("Madonna & Sabrina Carpenter") and one artist id, so a
//! collaboration cannot be told from a group by its name; MusicBrainz credits each artist of a recording on its own, and a
//! group such as "Aly & AJ" is one credit there. `recording-credits <limit>` asks for the recordings whose listened artist
//! looks like several, the most played first, and lands each answer under `.data/raw/musicbrainz/<date>/` before reading it.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::job::Job;
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

use crate::musicbrainz_extra::get;
use crate::scope::music_only;

const API: &str = "https://musicbrainz.org/ws/2";

const SQL_PENDING: &str = concat!(
    "SELECT listens.recording_mbid AS id FROM listens WHERE listens.recording_mbid IS NOT NULL AND listens.recording_mbid <> '' AND ",
    music_only!(),
    " AND (listens.artist_name LIKE '%, %' OR listens.artist_name LIKE '% & %' OR listens.artist_name LIKE '% x %' OR listens.artist_name LIKE '% feat%' OR listens.artist_name LIKE '% and %')",
    " AND listens.recording_mbid NOT IN (SELECT recording_mbid FROM recording_credit_fetched) GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?"
);
const SQL_FETCHED: &str = "INSERT OR REPLACE INTO recording_credit_fetched (recording_mbid, fetched_at) VALUES (?, ?)";
const SQL_DELETE: &str = "DELETE FROM recording_credit WHERE recording_mbid = ?";
const SQL_CREDIT: &str = "INSERT OR REPLACE INTO recording_credit (recording_mbid, position, artist_mbid, artist_name) VALUES (?, ?, ?, ?)";

/// One credited artist of a recording, as the recording names them.
#[derive(Debug, PartialEq, Eq)]
pub struct Credit {
    pub artist_mbid: Option<String>,
    pub name: String,
}

/// The artists a MusicBrainz recording credits, in order; the join phrases ("&", "feat.") are left out.
#[must_use]
pub fn credits_of(answer: &Value) -> Vec<Credit> {
    answer["artist-credit"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|credit| {
            let name = credit["name"].as_str().or_else(|| credit["artist"]["name"].as_str())?.trim();
            (!name.is_empty()).then(|| Credit { artist_mbid: credit["artist"]["id"].as_str().map(str::to_string), name: name.to_string() })
        })
        .collect()
}

pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let ids: Vec<String> = db.query(SQL_PENDING, &[json!(limit)])?.iter().filter_map(|row| row["id"].as_str().map(str::to_string)).collect();
    let (mut asked, mut credits) = (0, 0);
    for id in ids {
        let answer = get(&client, &format!("{API}/recording/{id}"), &[("inc", "artist-credits"), ("fmt", "json")])?;
        let found = match &answer {
            Some(answer) => {
                land(&directory.join(format!("recording-{id}.json")), answer)?;
                credits_of(answer)
            }
            None => Vec::new(),
        };
        let mut batch = vec![(SQL_DELETE.to_string(), vec![json!(id)])];
        batch.extend(found.iter().enumerate().map(|(at, credit)| (SQL_CREDIT.to_string(), vec![json!(id), json!(at), json!(credit.artist_mbid), json!(credit.name)])));
        batch.push((SQL_FETCHED.to_string(), vec![json!(id), json!(now())]));
        db.execute_batch(&batch)?;
        asked += 1;
        credits += found.len();
    }
    println!("recording-credits: {asked} recordings, {credits} credits");
    Ok(())
}

/// The job, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new(
        "recording-credits",
        "ask MusicBrainz who is credited on the recordings whose listened artist looks like several, the most played first, at most <limit> requests",
        |db, args| run(db, args.positional(0).parse().context("the limit must be a number")?),
    )
    .takes(&["limit"])]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_collaboration_is_each_credited_artist_and_a_group_is_one() {
        let duo = json!({"artist-credit": [{"name": "Madonna", "joinphrase": " & ", "artist": {"id": "m", "name": "Madonna"}}, {"name": "Sabrina Carpenter", "artist": {"id": "s", "name": "Sabrina Carpenter"}}]});
        assert_eq!(credits_of(&duo), [Credit { artist_mbid: Some("m".into()), name: "Madonna".into() }, Credit { artist_mbid: Some("s".into()), name: "Sabrina Carpenter".into() }]);
        let group = json!({"artist-credit": [{"name": "Aly & AJ", "artist": {"id": "g", "name": "Aly & AJ"}}]});
        assert_eq!(credits_of(&group).len(), 1);
        assert!(credits_of(&json!({})).is_empty());
    }
}
