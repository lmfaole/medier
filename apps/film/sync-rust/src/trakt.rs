//! The films, both ways with `Trakt` (`TRAKT_USER`, `TRAKT_CLIENT_ID`; the sign-in is `shared_data::trakt`). Films
//! `Trakt` has that the log lacks are appended to the log, matched on the `TMDB` number `Trakt` gives; then, once signed
//! in, the log's days are written to `Trakt`: for each film the log has, `Trakt` must hold the log's days, else its plays
//! of the film are removed and the log's days added (a film with no day is added with `Trakt`'s unknown day, 1970-01-01,
//! which is read back as no day; a play on the release day of a film with no day is such an old `released` and is replaced). A film `Trakt` has is never removed for a line removed from the log. Every page read is
//! landed unchanged under `.data/raw/trakt/<date>/`.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use anyhow::Result;
use serde_json::{json, Value};
use shared_data::sqlite_client::SqliteClient;
use shared_data::trakt::{known_day, send, Session, UNKNOWN_WATCHED_AT};
use shared_data::watch_log::Watch;

use crate::log::LOG;

const BATCH: usize = 300;
/// The viewings with the register's number: the log's own first, else the match for its title and year.
const VIEWINGS: &str = "SELECT viewing.day AS day, viewing.title AS title, viewing.year AS year, viewing.tmdb_id AS tmdb_id, film.release_date AS released, film.released_no AS released_no \
    FROM (SELECT watch.watched_on AS day, watch.title AS title, watch.year AS year, COALESCE(watch.tmdb_id, match.tmdb_id) AS tmdb_id \
        FROM film_watch AS watch LEFT JOIN film_match AS match ON match.title = watch.title AND match.year = COALESCE(watch.year, 0)) AS viewing \
    LEFT JOIN film_title AS film ON film.tmdb_id = viewing.tmdb_id";

/// One play of a film, as the history lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Play {
    pub id: i64,
    pub day: Option<String>,
    pub title: String,
    pub year: Option<i64>,
    pub tmdb_id: i64,
}

/// One viewing of the log with the number of its film.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Seen {
    pub day: Option<String>,
    pub tmdb_id: i64,
    /// The days the register gives the film's release: what the old `released` sends were turned into on `Trakt`.
    pub released: Vec<String>,
}

#[must_use]
pub fn plays_in(page: &Value) -> Vec<Play> {
    page.as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            Some(Play {
                id: entry["id"].as_i64()?,
                day: known_day(entry["watched_at"].as_str()?),
                title: entry["movie"]["title"].as_str()?.to_string(),
                year: entry["movie"]["year"].as_i64(),
                tmdb_id: entry["movie"]["ids"]["tmdb"].as_i64()?,
            })
        })
        .collect()
}

/// The log lines for films `Trakt` has and the log has no line for, on the day of their first play (none when unknown).
#[must_use]
pub fn new_watches(plays: &[Play], have: &HashSet<i64>) -> Vec<Watch> {
    let mut have = have.clone();
    let mut sorted = plays.to_vec();
    sorted.sort_by(|a, b| a.day.cmp(&b.day));
    sorted
        .into_iter()
        .filter(|play| have.insert(play.tmdb_id))
        .map(|play| Watch { watched_on: play.day, title: play.title, year: play.year, tmdb_id: Some(play.tmdb_id), ..Watch::default() })
        .collect()
}

/// What to change on `Trakt`: the ids of plays to remove and the (film, day) plays to add; a day of `None` is the unknown day.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub remove: Vec<i64>,
    pub add: Vec<(i64, Option<String>)>,
}

#[must_use]
pub fn plan(local: &[Seen], remote: &[Play]) -> Plan {
    let mut days: BTreeMap<i64, BTreeSet<String>> = BTreeMap::new();
    let mut released: BTreeMap<i64, &[String]> = BTreeMap::new();
    for seen in local {
        released.insert(seen.tmdb_id, &seen.released);
        let entry = days.entry(seen.tmdb_id).or_default();
        if let Some(day) = &seen.day {
            entry.insert(day.clone());
        }
    }
    let mut held: BTreeMap<i64, Vec<&Play>> = BTreeMap::new();
    for play in remote {
        held.entry(play.tmdb_id).or_default().push(play);
    }
    let mut plan = Plan::default();
    for (film, wanted) in days {
        let plays = held.remove(&film).unwrap_or_default();
        if wanted.is_empty() {
            // A play on the film's release day is what `released` made of it, never a viewing.
            let invented = !plays.is_empty() && plays.iter().all(|play| play.day.as_ref().is_some_and(|day| released.get(&film).is_some_and(|days| days.contains(day))));
            if plays.is_empty() || invented {
                plan.remove.extend(plays.iter().map(|play| play.id));
                plan.add.push((film, None));
            }
            continue;
        }
        if plays.len() == wanted.len() && plays.iter().filter_map(|play| play.day.clone()).collect::<BTreeSet<_>>() == wanted {
            continue;
        }
        plan.remove.extend(plays.iter().map(|play| play.id));
        plan.add.extend(wanted.into_iter().map(|day| (film, Some(day))));
    }
    plan
}

/// A viewing logged ahead of its day (a bought ticket) is no play yet: Trakt hears of a day once it has come.
#[must_use]
pub fn seen_until(seen: Vec<Seen>, today: &str) -> Vec<Seen> {
    seen.into_iter().filter(|seen| seen.day.as_deref().is_none_or(|day| day <= today)).collect()
}

#[must_use]
pub fn history_body(adds: &[(i64, Option<String>)]) -> Value {
    let movies: Vec<Value> = adds.iter().map(|(film, day)| json!({"ids": {"tmdb": film}, "watched_at": day.as_ref().map_or_else(|| UNKNOWN_WATCHED_AT.to_string(), |day| format!("{day}T12:00:00.000Z"))})).collect();
    json!({"movies": movies})
}

fn local_viewings(db: &SqliteClient) -> Result<(Vec<Seen>, usize)> {
    let rows = db.query(VIEWINGS, &[])?;
    let seen = rows.iter().filter_map(|row| Some(Seen { day: row["day"].as_str().map(str::to_string), tmdb_id: row["tmdb_id"].as_i64()?, released: ["released", "released_no"].iter().filter_map(|field| row[*field].as_str().map(str::to_string)).collect() })).collect::<Vec<_>>();
    Ok((seen, rows.len() - rows.iter().filter(|row| row["tmdb_id"].as_i64().is_some()).count()))
}

pub fn run(db: &SqliteClient, path: &std::path::Path, dry_run: bool) -> Result<()> {
    let session = Session::open("film-sync/0.1 (+https://sky.lmfaole.party/apps/medier/film)")?;
    let plays = plays_in(&Value::Array(session.history("movies")?));
    let (seen, _) = local_viewings(db)?;
    let added = new_watches(&plays, &seen.iter().map(|seen| seen.tmdb_id).collect());
    for watch in &added {
        LOG.append(path, watch)?;
    }
    let count = LOG.import(db, path)?;
    println!("trakt: {} plays, {} new lines in the log; {count} viewings in all", plays.len(), added.len());
    let Some(token) = &session.token else {
        println!("trakt: not signed in (trakt-login), so nothing is written to Trakt");
        return Ok(());
    };
    let (seen, unmatched) = local_viewings(db)?;
    if unmatched > 0 {
        println!("trakt: {unmatched} viewings have no TMDB number yet, so they are not sent (run tmdb, or write the number in the log)");
    }
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let plan = plan(&seen_until(seen, &today), &plays);
    println!("trakt: {} {} plays removed and {} added on Trakt", if dry_run { "would have" } else { "" }, plan.remove.len(), plan.add.len());
    if dry_run {
        return Ok(());
    }
    for chunk in plan.remove.chunks(BATCH) {
        send(&session.http, &session.key, token, "/sync/history/remove", &json!({"ids": chunk}))?;
    }
    let mut not_found = 0;
    for chunk in plan.add.chunks(BATCH) {
        let answer = send(&session.http, &session.key, token, "/sync/history", &history_body(chunk))?;
        not_found += answer["not_found"]["movies"].as_array().map_or(0, Vec::len);
    }
    if not_found > 0 {
        eprintln!("trakt: {not_found} films Trakt did not know");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(id: i64, day: &str, film: i64) -> Play {
        Play { id, day: Some(day.into()), title: "Heat".into(), year: Some(1995), tmdb_id: film }
    }

    fn seen(day: Option<&str>, film: i64) -> Seen {
        Seen { day: day.map(str::to_string), tmdb_id: film, released: vec!["1995-12-15".to_string()] }
    }

    #[test]
    fn a_film_trakt_has_and_the_log_lacks_is_added_once() {
        let plays = [play(1, "2026-02-01", 5), play(2, "2026-03-01", 5), play(3, "2026-01-01", 6)];
        let added = new_watches(&plays, &[6].into_iter().collect());
        assert_eq!(added.iter().map(|w| (w.watched_on.as_deref().unwrap_or_default(), w.tmdb_id)).collect::<Vec<_>>(), vec![("2026-02-01", Some(5))]);
    }

    #[test]
    fn the_log_decides_the_days_a_film_has_on_trakt_and_a_film_with_no_day_is_added_with_the_unknown_day() {
        let local = [seen(Some("2026-01-01"), 1), seen(Some("2026-02-02"), 2), seen(None, 3), seen(None, 4)];
        let remote = [play(10, "2026-01-01", 1), play(11, "2025-05-05", 2), play(12, "2024-01-01", 4)];
        let plan = plan(&local, &remote);
        assert_eq!(plan.remove, vec![11]);
        assert_eq!(plan.add, vec![(2, Some("2026-02-02".to_string())), (3, None)]);
        assert_eq!(history_body(&plan.add)["movies"][1], json!({"ids": {"tmdb": 3}, "watched_at": "1970-01-01T00:00:00.000Z"}));
    }

    #[test]
    fn a_viewing_dated_after_today_is_not_sent_to_trakt_yet() {
        let kept = seen_until(vec![seen(Some("2026-10-28"), 1), seen(Some("2026-10-31"), 2), seen(None, 3)], "2026-10-28");
        assert_eq!(kept.iter().map(|seen| seen.tmdb_id).collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn a_play_on_the_release_day_of_a_film_with_no_day_is_replaced_by_the_unknown_day() {
        let plan = plan(&[seen(None, 5), seen(None, 6)], &[play(1, "1995-12-15", 5), play(2, "2024-01-01", 6)]);
        assert_eq!((plan.remove, plan.add), (vec![1], vec![(5, None)]));
    }

    #[test]
    fn trakts_unknown_day_is_no_day_and_is_replaced_when_the_log_learns_the_day() {
        let page = json!([{"id": 1, "watched_at": "1970-01-01T00:00:00.000Z", "movie": {"title": "Heat", "year": 1995, "ids": {"tmdb": 5}}}]);
        let plays = plays_in(&page);
        assert_eq!(plays[0].day, None);
        assert_eq!(new_watches(&plays, &HashSet::new())[0].watched_on, None);
        assert_eq!(super::plan(&[seen(None, 5)], &plays), Plan::default());
        let plan = super::plan(&[seen(Some("2026-01-01"), 5)], &plays);
        assert_eq!((plan.remove, plan.add), (vec![1], vec![(5, Some("2026-01-01".to_string()))]));
    }
}
