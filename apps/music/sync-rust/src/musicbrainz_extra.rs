//! The facts about what was heard that ListenBrainz' metadata does not carry, asked of MusicBrainz and Wikidata directly:
//! the kind of release (album, single, live), the label, when an artist was active and a picture of them. One request a
//! second, the most played first, so `enrich-extra <limit>` works through the backlog a few hundred a night. Each answer is
//! landed unchanged under `.data/raw/musicbrainz/<date>/` before it is read.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::StatusCode;
use serde_json::{json, Value};
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

const API: &str = "https://musicbrainz.org/ws/2";
const WIKIDATA: &str = "https://www.wikidata.org/wiki/Special:EntityData";
const COMMONS: &str = "https://commons.wikimedia.org/wiki/Special:FilePath";
/// MusicBrainz allows one request a second.
const PAUSE: Duration = Duration::from_millis(1100);
const RETRY_PAUSE: Duration = Duration::from_secs(10);
const ATTEMPTS: u32 = 4;

// The most played first: a release group, release or artist counts once for each listen of a recording on it.
const SQL_GROUPS: &str = "SELECT recording_metadata.release_group_mbid AS id FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.release_group_mbid IS NOT NULL \
      AND recording_metadata.release_group_mbid NOT IN (SELECT release_group_mbid FROM release_group_info) \
    GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?";
const SQL_RELEASES: &str = "SELECT recording_metadata.caa_release_mbid AS id FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.caa_release_mbid IS NOT NULL \
      AND recording_metadata.caa_release_mbid NOT IN (SELECT release_mbid FROM release_label) \
    GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?";
const SQL_ARTISTS: &str = "SELECT recording_metadata.artist_mbid AS id FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.artist_mbid IS NOT NULL \
      AND recording_metadata.artist_mbid NOT IN (SELECT artist_mbid FROM artist_info) \
    GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?";

#[derive(Debug, PartialEq, Eq)]
pub struct GroupFacts {
    pub primary_type: Option<String>,
    pub secondary_types: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ArtistFacts {
    pub begin_year: Option<i64>,
    pub end_year: Option<i64>,
    pub ended: bool,
    pub wikidata_id: Option<String>,
}

fn year_of(date: &Value) -> Option<i64> {
    date.as_str()?.get(..4)?.parse().ok()
}

#[must_use]
pub fn group_facts(answer: &Value) -> GroupFacts {
    let secondary: Vec<&str> = answer["secondary-types"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    GroupFacts { primary_type: answer["primary-type"].as_str().map(str::to_string), secondary_types: (!secondary.is_empty()).then(|| secondary.join(",")) }
}

/// The first label a release names; «[no label]» is MusicBrainz' way of saying there is none.
#[must_use]
pub fn label_of(answer: &Value) -> Option<String> {
    answer["label-info"].as_array().into_iter().flatten().filter_map(|info| info["label"]["name"].as_str()).find(|name| *name != "[no label]").map(str::to_string)
}

#[must_use]
pub fn artist_facts(answer: &Value) -> ArtistFacts {
    let wikidata_id = answer["relations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|relation| relation["type"] == "wikidata")
        .filter_map(|relation| relation["url"]["resource"].as_str())
        .find_map(|address| address.rsplit('/').next().filter(|id| id.starts_with('Q') && id[1..].chars().all(|c| c.is_ascii_digit())))
        .map(str::to_string);
    ArtistFacts { begin_year: year_of(&answer["life-span"]["begin"]), end_year: year_of(&answer["life-span"]["end"]), ended: answer["life-span"]["ended"] == true, wikidata_id }
}

/// The picture Wikidata names for an entity (`P18`), as an address on Wikimedia Commons that serves a 400 px wide copy.
#[must_use]
pub fn image_of(entity: &Value, id: &str) -> Option<String> {
    let name = entity["entities"][id]["claims"]["P18"].as_array()?.iter().find_map(|claim| claim["mainsnak"]["datavalue"]["value"].as_str())?;
    let encoded: String = name.replace(' ', "_").bytes().map(|byte| if byte.is_ascii_alphanumeric() || b"-_.~()".contains(&byte) { char::from(byte).to_string() } else { format!("%{byte:02X}") }).collect();
    Some(format!("{COMMONS}/{encoded}?width=400"))
}

/// A 429 or any 5xx (500, 502, 503, 504) is the register being busy or briefly broken: ask again after a pause instead of failing the run.
#[must_use]
pub(crate) fn is_transient(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// One JSON answer, or none where the register says the thing is gone (404). A 429 or a 5xx is retried a few times.
pub(crate) fn get(client: &reqwest::blocking::Client, address: &str, query: &[(&str, &str)]) -> Result<Option<Value>> {
    for attempt in 1..=ATTEMPTS {
        std::thread::sleep(PAUSE);
        let response = client.get(address).query(query).send().with_context(|| format!("asking {address}"))?;
        match response.status() {
            StatusCode::NOT_FOUND => return Ok(None),
            status if is_transient(status) && attempt < ATTEMPTS => std::thread::sleep(RETRY_PAUSE),
            status if status.is_success() => return Ok(Some(response.json().with_context(|| format!("reading the answer of {address}"))?)),
            status => bail!("{address} answered {status}"),
        }
    }
    bail!("{address} kept asking to slow down")
}

fn pending(db: &SqliteClient, sql: &str, limit: usize) -> Result<Vec<String>> {
    Ok(db.query(sql, &[json!(limit)])?.iter().filter_map(|row| row["id"].as_str().map(str::to_string)).collect())
}

/// Works through at most `limit` requests: the artists first (their years and their pictures are what the pages show
/// most, and there are fewest of them), then the release groups, then the labels, each the most played first.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("musicbrainz")?;
    let (mut artists, mut groups, mut labels, mut spent) = (0, 0, 0, 0);
    for id in pending(db, SQL_ARTISTS, limit)? {
        if spent >= limit {
            break;
        }
        spent += 1;
        let answer = get(&client, &format!("{API}/artist/{id}"), &[("inc", "url-rels"), ("fmt", "json")])?;
        let facts = answer.as_ref().map(|answer| land(&directory.join(format!("artist-{id}.json")), answer).map(|()| artist_facts(answer))).transpose()?;
        let image = match facts.as_ref().and_then(|facts| facts.wikidata_id.as_deref()) {
            Some(entity) => {
                spent += 1;
                let found = get(&client, &format!("{WIKIDATA}/{entity}.json"), &[])?;
                found.as_ref().map(|found| land(&directory.join(format!("wikidata-{entity}.json")), found).map(|()| image_of(found, entity))).transpose()?.flatten()
            }
            None => None,
        };
        let facts = facts.unwrap_or(ArtistFacts { begin_year: None, end_year: None, ended: false, wikidata_id: None });
        db.execute(
            "INSERT OR REPLACE INTO artist_info (artist_mbid, begin_year, end_year, ended, wikidata_id, image, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            &[json!(id), json!(facts.begin_year), json!(facts.end_year), json!(i64::from(facts.ended)), json!(facts.wikidata_id), json!(image), json!(now())],
        )?;
        artists += 1;
    }
    for id in pending(db, SQL_GROUPS, limit.saturating_sub(spent))? {
        spent += 1;
        let answer = get(&client, &format!("{API}/release-group/{id}"), &[("fmt", "json")])?;
        let facts = answer.as_ref().map(|answer| land(&directory.join(format!("release-group-{id}.json")), answer).map(|()| group_facts(answer))).transpose()?;
        let (primary, secondary) = facts.map_or((None, None), |facts| (facts.primary_type, facts.secondary_types));
        db.execute("INSERT OR REPLACE INTO release_group_info (release_group_mbid, primary_type, secondary_types, fetched_at) VALUES (?, ?, ?, ?)", &[json!(id), json!(primary), json!(secondary), json!(now())])?;
        groups += 1;
    }
    for id in pending(db, SQL_RELEASES, limit.saturating_sub(spent))? {
        let answer = get(&client, &format!("{API}/release/{id}"), &[("inc", "labels"), ("fmt", "json")])?;
        let label = answer.as_ref().map(|answer| land(&directory.join(format!("release-{id}.json")), answer).map(|()| label_of(answer))).transpose()?.flatten();
        db.execute("INSERT OR REPLACE INTO release_label (release_mbid, label, fetched_at) VALUES (?, ?, ?)", &[json!(id), json!(label), json!(now())])?;
        labels += 1;
    }
    println!("enrich-extra: {artists} artists, {groups} release groups, {labels} labels");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn busy_or_broken_answers_are_retried_but_not_client_errors() {
        use reqwest::StatusCode;
        for code in [429, 500, 502, 503, 504] {
            assert!(super::is_transient(StatusCode::from_u16(code).unwrap()), "{code}");
        }
        for code in [200, 400, 403, 404] {
            assert!(!super::is_transient(StatusCode::from_u16(code).unwrap()), "{code}");
        }
    }

    use super::*;

    #[test]
    fn a_release_group_tells_its_kinds_and_a_release_its_first_real_label() {
        let group = group_facts(&json!({"primary-type": "Album", "secondary-types": ["Live", "Compilation"]}));
        assert_eq!((group.primary_type.as_deref(), group.secondary_types.as_deref()), (Some("Album"), Some("Live,Compilation")));
        assert_eq!(group_facts(&json!({"primary-type": "Single"})).secondary_types, None);
        let release = json!({"label-info": [{"label": {"name": "[no label]"}}, {"label": {"name": "XL Recordings"}}, {"label": null}]});
        assert_eq!(label_of(&release).as_deref(), Some("XL Recordings"));
        assert_eq!(label_of(&json!({"label-info": []})), None);
    }

    #[test]
    fn an_artist_has_years_active_and_the_wikidata_entry_its_relations_name() {
        let facts = artist_facts(&json!({
            "life-span": {"begin": "1990-05-01", "end": "2004", "ended": true},
            "relations": [{"type": "official homepage", "url": {"resource": "https://x.test"}}, {"type": "wikidata", "url": {"resource": "https://www.wikidata.org/wiki/Q42"}}]
        }));
        assert_eq!(facts, ArtistFacts { begin_year: Some(1990), end_year: Some(2004), ended: true, wikidata_id: Some("Q42".into()) });
        assert_eq!(artist_facts(&json!({})), ArtistFacts { begin_year: None, end_year: None, ended: false, wikidata_id: None });
    }

    #[test]
    fn a_wikidata_picture_becomes_a_commons_address_with_the_name_escaped() {
        let entity = json!({"entities": {"Q42": {"claims": {"P18": [{"mainsnak": {"datavalue": {"value": "Björk 2015 (cropped).jpg"}}}]}}}});
        assert_eq!(image_of(&entity, "Q42").as_deref(), Some("https://commons.wikimedia.org/wiki/Special:FilePath/Bj%C3%B6rk_2015_(cropped).jpg?width=400"));
        assert_eq!(image_of(&json!({"entities": {"Q42": {"claims": {}}}}), "Q42"), None);
    }
}
