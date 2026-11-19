//! `RomM`, the owner's own retro library: `games-sync romm` reads every ROM, keeps them in `game_romm` (replaced whole,
//! so a ROM removed from `RomM` goes too) and adds each as `owned` to the collection, as Steam's games are. Each play
//! session `RomM` recorded becomes a line of the log (`romm-session:<id>`, `playing`, its hours), added once, so the
//! history shows the days played and the hours add up. The game page links to the ROM by `romm_id`; nothing else of it
//! is ever published. `RomM` itself is not asked: its own repository (`ROMM_DIR`, else `~/Dokumenter/romm`) lands the
//! API's answers under `raw/api/<date>/` (`romm-export.ts`, daily at 04:00) and this reads the newest folder.

use anyhow::{Context, Result};
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use shared_data::shelf::{now, Entry, Ledger, Session};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::text;
use std::path::{Path, PathBuf};

/// A session shorter than this is an accidental open, not play.
const SHORTEST_SESSION_MS: i64 = 60_000;
const DELETE_ALL: &str = "DELETE FROM game_romm";

#[derive(Debug, PartialEq)]
struct Rom {
    id: i64,
    platform: String,
    title: String,
    igdb_id: Option<String>,
    ra_id: Option<String>,
}

fn number(value: &Value) -> Option<String> {
    value.as_i64().filter(|number| *number > 0).map(|number| number.to_string())
}

/// The ROMs of one page of `/api/roms`; one without a number, a name or a platform is left out.
fn roms_in(page: &Value) -> Vec<Rom> {
    page["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|rom| {
            Some(Rom { id: rom["id"].as_i64()?, platform: text(&rom["platform_slug"])?, title: text(&rom["name"])?, igdb_id: number(&rom["igdb_id"]), ra_id: number(&rom["ra_id"]) })
        })
        .collect()
}

/// Every ROM is `owned` with the platform as its format; IGDB's number, when `RomM` has matched one, settles the work.
fn entry_of(rom: &Rom) -> Entry {
    Entry { title: rom.title.clone(), status: "owned".to_string(), source: Some(format!("romm:{}", rom.id)), format: Some(rom.platform.clone()), ext_id: rom.igdb_id.clone(), ..Entry::default() }
}

/// The day a session ended where the owner lives. `RomM` writes its times in UTC, with or without an offset, and a session
/// after midnight local time is still the day before in UTC.
fn day_of<Zone: TimeZone>(ended: &str, zone: &Zone) -> Option<NaiveDate> {
    let utc = DateTime::parse_from_rfc3339(ended).map(|at| at.with_timezone(&Utc)).or_else(|_| NaiveDateTime::parse_from_str(ended, "%Y-%m-%dT%H:%M:%S%.f").map(|at| Utc.from_utc_datetime(&at))).ok()?;
    Some(utc.with_timezone(zone).date_naive())
}

/// One line of the log per session of at least a minute for a ROM the library has; hours to two decimals, so a short
/// session does not round to nothing, and the session's own number is the `source`, so each is added once.
fn played_in(roms: &[Rom], sessions: &Value) -> Vec<Entry> {
    sessions
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|session| {
            let milliseconds = session["duration_ms"].as_i64().filter(|ms| *ms >= SHORTEST_SESSION_MS)?;
            let rom = roms.iter().find(|rom| Some(rom.id) == session["rom_id"].as_i64())?;
            let ended = session["end_time"].as_str()?;
            let day = day_of(ended, &Local);
            Some(Entry {
                on_date: day.map(|day| day.to_string()),
                status: "playing".to_string(),
                amount: Some((f64::from(i32::try_from(milliseconds / 1000).unwrap_or(i32::MAX)) / 36.0).round() / 100.0),
                source: Some(format!("romm-session:{}", session["id"].as_i64()?)),
                ..Entry { title: rom.title.clone(), format: Some(rom.platform.clone()), ext_id: rom.igdb_id.clone(), ..Entry::default() }
            })
        })
        .collect()
}

/// The newest day `RomM`'s repository landed (the folders are named by date, so they sort).
fn newest_landing() -> Result<PathBuf> {
    let service = std::env::var_os("ROMM_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Dokumenter/romm")))
        .unwrap_or_default();
    let raw = service.join("raw/api");
    let mut days: Vec<PathBuf> = std::fs::read_dir(&raw)
        .with_context(|| format!("reading {}: run `npm run export` in the RomM repository", raw.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    days.sort();
    days.pop().with_context(|| format!("no landing under {}: run `npm run export` in the RomM repository", raw.display()))
}

/// The pages of one endpoint in `folder` (`<prefix>-<offset>.json`), in the order the offsets ran.
fn pages_in(folder: &Path, prefix: &str) -> Result<Vec<Value>> {
    let mut found: Vec<(usize, PathBuf)> = std::fs::read_dir(folder)
        .with_context(|| format!("reading {}", folder.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter_map(|path| {
            let offset = path.file_name()?.to_str()?.strip_prefix(prefix)?.strip_prefix('-')?.strip_suffix(".json")?.parse().ok()?;
            Some((offset, path))
        })
        .collect();
    found.sort();
    found
        .into_iter()
        .map(|(_, path)| serde_json::from_slice(&std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?).with_context(|| format!("parsing {}", path.display())))
        .collect()
}

fn save(db: &SqliteClient, roms: &[Rom], fetched_at: i64) -> Result<()> {
    let mut batch = vec![(DELETE_ALL.to_string(), vec![])];
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "game_romm",
        &["romm_id", "platform", "title", "igdb_id", "ra_id", "fetched_at"],
        roms.iter().map(|rom| vec![json!(rom.id), json!(rom.platform), json!(rom.title), json!(rom.igdb_id), json!(rom.ra_id), json!(fetched_at)]),
    ));
    db.execute_batch(&batch).context("storing the ROMs of RomM")
}

pub fn run(session: &Session) -> Result<()> {
    let folder = newest_landing()?;
    let pages = pages_in(&folder, "roms")?;
    let roms: Vec<Rom> = pages.iter().flat_map(roms_in).collect();
    let recorded: Vec<Value> = pages_in(&folder, "play-sessions")?.iter().filter_map(Value::as_array).flatten().cloned().collect();
    save(&session.db, &roms, now())?;
    let owned: Vec<Entry> = roms.iter().map(entry_of).collect();
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &owned)?;
    let started = session.shelf.append_new(&session.db, &session.log, &played_in(&roms, &Value::Array(recorded)))?;
    println!("romm: {} ROMs, {added} added to the collection, {started} play sessions added to the log", roms.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Value {
        json!({"items": [
            {"id": 1, "name": "Pokémon Emerald Version", "platform_slug": "gba", "igdb_id": 1517, "ra_id": 668},
            {"id": 2, "name": "Homebrew", "platform_slug": "gba", "igdb_id": null, "ra_id": null},
            {"name": "No number", "platform_slug": "gba"}
        ], "total": 3})
    }

    #[test]
    fn a_rom_is_owned_with_its_platform_and_the_register_s_number() {
        let roms = roms_in(&page());
        assert_eq!(roms.len(), 2);
        let (emerald, homebrew) = (entry_of(&roms[0]), entry_of(&roms[1]));
        assert_eq!((emerald.status.as_str(), emerald.source.as_deref(), emerald.format.as_deref(), emerald.ext_id.as_deref()), ("owned", Some("romm:1"), Some("gba"), Some("1517")));
        assert_eq!(homebrew.ext_id, None);
    }

    #[test]
    fn a_session_is_one_log_line_with_its_hours_and_its_own_number() {
        let roms = roms_in(&page());
        let played = played_in(&roms, &json!([
            {"id": 1, "rom_id": 1, "end_time": "2026-10-22T19:11:11", "duration_ms": 5_400_000},
            {"id": 2, "rom_id": 1, "end_time": "2026-10-23T08:00:00+00:00", "duration_ms": 1_800_000}
        ]));
        let seen: Vec<_> = played.iter().map(|entry| (entry.source.as_deref(), entry.amount, entry.on_date.as_deref(), entry.status.as_str())).collect();
        assert_eq!(seen, [(Some("romm-session:1"), Some(1.5), Some("2026-10-22"), "playing"), (Some("romm-session:2"), Some(0.5), Some("2026-10-23"), "playing")]);
        assert_eq!((played[0].title.as_str(), played[0].ext_id.as_deref(), played[0].format.as_deref()), ("Pokémon Emerald Version", Some("1517"), Some("gba")));
    }

    #[test]
    fn a_session_after_midnight_local_time_is_the_local_day() {
        let oslo = chrono::FixedOffset::east_opt(2 * 3600).expect("offset");
        let day = |ended: &str| day_of(ended, &oslo).map(|day| day.to_string());
        assert_eq!(day("2026-10-22T22:30:00").as_deref(), Some("2026-10-23"));
        assert_eq!(day("2026-10-22T21:59:59+00:00").as_deref(), Some("2026-10-22"));
        assert_eq!(day("not a time"), None);
    }

    #[test]
    fn a_session_under_a_minute_or_for_an_unknown_rom_is_left_out() {
        let played = played_in(&roms_in(&page()), &json!([
            {"id": 1, "rom_id": 1, "end_time": "2026-10-22T19:11:11", "duration_ms": 59_999},
            {"id": 2, "rom_id": 99, "end_time": "2026-10-22T19:11:11", "duration_ms": 600_000},
            {"id": 3, "rom_id": 1, "end_time": "2026-10-22T19:11:11", "duration_ms": 211_580}
        ]));
        assert_eq!(played.iter().map(|entry| (entry.source.as_deref(), entry.amount)).collect::<Vec<_>>(), [(Some("romm-session:3"), Some(0.06))]);
    }

    #[test]
    fn the_pages_of_an_endpoint_come_in_offset_order_and_others_are_left_alone() {
        let folder = std::env::temp_dir().join(format!("romm-pages-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("folder");
        for (name, body) in [("roms-100.json", r#"{"items":[{"id":2}]}"#), ("roms-0.json", r#"{"items":[{"id":1}]}"#), ("play-sessions-0.json", "[]"), ("notes.txt", "x")] {
            std::fs::write(folder.join(name), body).expect("write");
        }
        let ids: Vec<_> = pages_in(&folder, "roms").expect("pages").iter().map(|page| page["items"][0]["id"].as_i64()).collect();
        assert_eq!(ids, [Some(1), Some(2)]);
        assert_eq!(pages_in(&folder, "play-sessions").expect("sessions").len(), 1);
        std::fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn the_roms_are_replaced_whole_and_a_removed_one_goes() {
        let db = shared_data::app_db::memory_with_schema(include_str!("../../../../db/games.sql"));
        let count = || db.query("SELECT COUNT(*) AS n FROM game_romm", &[]).ok().and_then(|rows| rows[0]["n"].as_i64()).unwrap_or(-1);
        save(&db, &roms_in(&page()), 1).expect("save");
        assert_eq!(count(), 2);
        save(&db, &roms_in(&page())[..1], 2).expect("save again");
        assert_eq!(count(), 1);
    }
}
