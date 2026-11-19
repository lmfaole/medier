//! `Pokémon GO`, played on a phone with no account to ask: Niantic's data export (a zip made by "request your data") is
//! landed by hand under `.data/raw/pokemon-go/<date>/` (`npm run land -- pokemon-go <folder>`) and `games-sync pokemon-go`
//! reads two things from it: when the game was started (`Gameplay.txt`) and each launch of the app (`Player_Journey/
//! App_Sessions.csv`), which becomes one line of the log for every day the game was opened. The export has no length for
//! a session, so a line has no hours. The medals of the gameplay summary (`BADGE_TRADING: 2`) are the game's achievements:
//! each is one, unlocked on a day nobody knows (the export has none), with its level as the description. Everything else in it (where the owner walked, what was bought, who the friends are,
//! the steps and the calories) is location, money, other people and health, and is never read here.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime};
use shared_data::shelf::{Entry, Session};

use crate::achievement::{save, Achievement};
use crate::profile::{self, Reading};

const TITLE: &str = "Pokémon GO";

/// The day the game was started, from the line `Start date: 05/14/2017` of the gameplay summary.
fn started_in(text: &str) -> Option<NaiveDate> {
    let value = text.lines().find_map(|line| line.strip_prefix("Start date:"))?.trim();
    NaiveDate::parse_from_str(value, "%m/%d/%Y").ok()
}

/// The tier a medal's level names, where it is one of the four a medal has; a larger number is a count (the mini collection).
fn tier_of(level: i64) -> String {
    match level {
        1 => "bronse".to_string(),
        2 => "sølv".to_string(),
        3 => "gull".to_string(),
        4 => "platina".to_string(),
        count => format!("{count}"),
    }
}

/// The medals the game names the same way in every export, with the name the game shows and what the medal counts. A key is
/// either `BADGE_…` or the start of a `Badge: Win X Gym battles. where X is : 2` line. A medal not here (an event's, a new
/// one) keeps its key as its name.
/// `(key, name, what, thresholds)`: the thresholds are what bronze, silver, gold and platinum ask, as far as they are known
/// (a source's list, not the game's own, so the pages say «ca.»); none for a medal an event gave.
const MEDALS: &[(&str, &str, &str, &[f64])] = &[
    ("km walked", "Jogger", "kilometer gått", &[10.0, 100.0, 1000.0, 10_000.0]),
    ("Catch X Pokemon", "Collector", "Pokémon fanget", &[30.0, 500.0, 2000.0, 50_000.0]),
    ("Evolve X Pokemon", "Scientist", "Pokémon utviklet", &[3.0, 20.0, 200.0, 2000.0]),
    ("Hatch X Eggs", "Breeder", "egg klekket", &[10.0, 100.0, 1000.0, 2500.0]),
    ("Visit X PokeStops", "Backpacker", "PokéStops besøkt", &[100.0, 1000.0, 10_000.0, 50_000.0]),
    ("Visit X unique PokeStops", "Unike PokéStops", "ulike PokéStops besøkt", &[]),
    ("Win X Gym battles", "Battle Girl", "gymkamper vunnet", &[10.0, 100.0, 1000.0, 4000.0]),
    ("hours defended", "Gym Leader", "timer et gym er forsvart", &[10.0, 100.0, 1000.0, 15_000.0]),
    ("berries fed", "Berry Master", "bær gitt i gym", &[10.0, 100.0, 1000.0, 15_000.0]),
    ("raid battles won", "Champion", "raid-kamper vunnet", &[10.0, 100.0, 1000.0, 2000.0]),
    ("Win X Legendary Raids", "Legendary Pokémon", "legendariske raid-kamper vunnet", &[10.0, 100.0, 1000.0, 2000.0]),
    ("challenge quests", "Pokémon Ranger", "forskningsoppgaver fullført", &[10.0, 100.0, 1000.0, 2500.0]),
    ("Train X times", "Ace Trainer", "treningsøkter", &[10.0, 100.0, 1000.0, 2000.0]),
    ("Catch X Pikachu", "Pikachu Fan", "Pikachu fanget", &[3.0, 50.0, 300.0, 1000.0]),
    ("Catch X Unown", "Unown", "Unown fanget", &[3.0, 10.0, 26.0, 28.0]),
    ("Catch X tiny Rattata", "Youngster", "små Rattata fanget", &[3.0, 50.0, 300.0, 1000.0]),
    ("Catch X big Magikarp", "Fisher", "store Magikarp fanget", &[3.0, 50.0, 300.0, 1000.0]),
    ("Catch X Normal-type Pokemon", "SchoolKid", "normal-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Fighting-type Pokemon", "Black Belt", "kamp-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Flying-type Pokemon", "Bird Keeper", "flyvende Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Poison-type Pokemon", "Punk Girl", "gift-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Ground-type Pokemon", "Ruin Maniac", "bakke-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Rock-type Pokemon", "Hiker", "stein-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Bug-type Pokemon", "Bug Catcher", "insekt-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Ghost-type Pokemon", "Hex Maniac", "spøkelse-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Steel-type Pokemon", "Depot Agent", "stål-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Fire-type Pokemon", "Kindler", "ild-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Water-type Pokemon", "Swimmer", "vann-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Grass-type Pokemon", "Gardener", "gress-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Electric-type Pokemon", "Rocker", "elektriske Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Psychic-type Pokemon", "Psychic", "psykiske Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Ice-type Pokemon", "Skier", "is-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Dragon-type Pokemon", "Dragon Tamer", "drage-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Dark-type Pokemon", "Delinquent", "mørke Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Catch X Fairy-type Pokemon", "Fairy Tale Girl", "fe-Pokémon fanget", &[10.0, 50.0, 200.0]),
    ("Register X Kanto region Pokemon in the Pokedex", "Kanto", "Pokémon fra Kanto i Pokédexen", &[20.0, 50.0, 100.0, 151.0]),
    ("Register X Pokemon first discovered in the Johto region to the Pokedex", "Johto", "Pokémon fra Johto i Pokédexen", &[5.0, 30.0, 70.0, 100.0]),
    ("Register X Pokemon first discovered in the Hoenn region to the Pokedex", "Hoenn", "Pokémon fra Hoenn i Pokédexen", &[5.0, 40.0, 90.0, 135.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN4", "Sinnoh", "Pokémon fra Sinnoh i Pokédexen", &[5.0, 30.0, 80.0, 107.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN5", "Unova", "Pokémon fra Unova i Pokédexen", &[5.0, 50.0, 100.0, 156.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN6", "Kalos", "Pokémon fra Kalos i Pokédexen", &[5.0, 20.0, 50.0, 72.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN7", "Alola", "Pokémon fra Alola i Pokédexen", &[5.0, 25.0, 50.0, 86.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN8", "Galar", "Pokémon fra Galar i Pokédexen", &[5.0, 25.0, 50.0, 89.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN8A", "Hisui", "Pokémon fra Hisui i Pokédexen", &[1.0, 3.0, 5.0, 7.0]),
    ("BADGE_POKEDEX_ENTRIES_GEN9", "Paldea", "Pokémon fra Paldea i Pokédexen", &[]),
    ("BADGE_TRADING", "Gentleman", "Pokémon byttet", &[10.0, 100.0, 1000.0, 2500.0]),
    ("BADGE_TRADING_DISTANCE", "Pilot", "avstand Pokémon er byttet over", &[1000.0, 100_000.0, 1_000_000.0, 10_000_000.0]),
    ("BADGE_MAX_LEVEL_FRIENDS", "Idol", "beste venner", &[1.0, 2.0, 3.0, 20.0]),
    ("BADGE_GREAT_LEAGUE", "Great League Veteran", "kamper vunnet i Great League", &[5.0, 50.0, 200.0, 1000.0]),
    ("BADGE_ULTRA_LEAGUE", "Ultra League Veteran", "kamper vunnet i Ultra League", &[5.0, 50.0, 200.0, 1000.0]),
    ("BADGE_MASTER_LEAGUE", "Master League Veteran", "kamper vunnet i Master League", &[5.0, 50.0, 200.0, 1000.0]),
    ("BADGE_PHOTOBOMB", "Cameraman", "overraskelser i GO Snapshot", &[10.0, 50.0, 200.0, 400.0]),
    ("BADGE_ROCKET_GRUNTS_DEFEATED", "Hero", "Team GO Rocket-grunter beseiret", &[10.0, 100.0, 1000.0, 2000.0]),
    ("BADGE_ROCKET_GIOVANNI_DEFEATED", "Ultra Hero", "ganger Giovanni er beseiret", &[1.0, 5.0, 20.0, 50.0]),
    ("BADGE_POKEMON_PURIFIED", "Purifier", "Shadow-Pokémon renset", &[1.0, 50.0, 500.0, 1000.0]),
    ("BADGE_UNIQUE_MEGA_EVOS", "Mega Evolution Guru", "ulike Pokémon mega-utviklet", &[1.0, 24.0, 36.0, 46.0]),
    ("BADGE_TOTAL_MEGA_EVOS", "Successor", "mega-utviklinger", &[1.0, 50.0, 500.0, 1000.0]),
    ("BADGE_UNIQUE_RAID_BOSSES_DEFEATED", "Rising Star", "ulike raid-sjefer beseiret", &[2.0, 10.0, 50.0, 150.0]),
    ("BADGE_RAIDS_WITH_FRIENDS", "Rising Star Duo", "raid-kamper vunnet med en venn", &[10.0, 100.0, 1000.0, 2000.0]),
    ("BADGE_7_DAY_STREAKS", "Triathlete", "sju dagers rekker", &[1.0, 10.0, 50.0, 100.0]),
    ("BADGE_CAPTURE_SMALL_POKEMON", "Tiny Pokémon Collector", "bitte små Pokémon fanget", &[5.0, 25.0, 100.0, 500.0]),
    ("BADGE_CAPTURE_LARGE_POKEMON", "Jumbo Pokémon Collector", "kjempestore Pokémon fanget", &[5.0, 25.0, 100.0, 500.0]),
    ("BADGE_POKEMON_CAUGHT_AT_YOUR_LURES", "Picnicker", "Pokémon andre fanget ved dine lokkemidler", &[]),
    ("BADGE_TRAINERS_REFERRED", "Friend Finder", "trenere du har henvist", &[]),
    ("BADGE_BUDDY_BEST", "Best Buddy", "beste kompis-nivåer", &[]),
    ("BADGE_BUTTERFLY_COLLECTOR", "Butterfly Collector", "sommerfugl-Pokémon fanget", &[]),
];

/// `BADGE_POKEDEX_ENTRIES_GEN4` as «Pokedex entries gen4»: the key's words, the first with a capital.
fn medal_title(key: &str) -> String {
    let words = key.trim_start_matches("BADGE_").to_lowercase().replace('_', " ");
    let mut letters = words.chars();
    letters.next().map(|first| first.to_uppercase().chain(letters).collect()).unwrap_or_default()
}

/// A medal's key and level from a line of the summary: `\tBADGE_TRADING: 2` or `\tBadge: Win X Gym battles. where X is : 2`.
fn medal_in(line: &str) -> Option<(String, i64)> {
    let line = line.trim();
    let (text, level) = line.rsplit_once(':')?;
    let level: i64 = level.trim().parse().ok().filter(|level| *level > 0)?;
    if line.starts_with("BADGE_") {
        return Some((text.trim().to_string(), level));
    }
    let key = line.strip_prefix("Badge:")?.rsplit_once(':')?.0.split(". where").next()?.trim().trim_end_matches(':').trim();
    (!key.is_empty()).then(|| (key.to_string(), level))
}

/// What the summary says the player has done, for the medals whose count it gives: the kilometers walked and the eggs hatched.
fn counts_in(text: &str) -> Vec<(&'static str, f64)> {
    let km = text.lines().find_map(|line| line.strip_prefix("Distance walked:")).and_then(|value| value.trim().trim_end_matches("km").trim().parse::<f64>().ok());
    let eggs = text.lines().find_map(|line| line.strip_prefix("You have hatched ")).and_then(|rest| rest.split_whitespace().next()).and_then(|count| count.parse::<f64>().ok());
    km.map(|km| ("km walked", km)).into_iter().chain(eggs.map(|eggs| ("Hatch X Eggs", eggs))).collect()
}

/// A medal a source's list gives four tiers of: its tier is the level, its next step the threshold above it.
const TIERS: i64 = 4;

/// The achievements of the gameplay summary: one for each medal listed, unlocked (`unlocked_at` 0 is a day nobody knows)
/// because a medal is only listed once it is earned. A medal the table knows has its tier, and the next tier's threshold
/// as the target; one whose count the summary gives (kilometers, eggs) also has how far it is.
fn achievements_in(text: &str) -> Vec<Achievement> {
    let counts = counts_in(text);
    text.lines()
        .filter_map(medal_in)
        .map(|(key, level)| {
            let known = MEDALS.iter().find(|(wanted, ..)| *wanted == key);
            let title = known.map_or_else(|| medal_title(&key), |(_, name, ..)| (*name).to_string());
            let counts_what = known.map_or(String::new(), |(_, _, what, _)| format!(": {what}"));
            let description = if (1..=4).contains(&level) { format!("Medalje i Pokémon GO, {}{counts_what}", tier_of(level)) } else { format!("Medalje i Pokémon GO, nivå {level}{counts_what}") };
            let tiered = known.is_some() && (1..=TIERS).contains(&level);
            let target = known.filter(|_| tiered && level < TIERS).and_then(|(_, _, _, thresholds)| thresholds.get(usize::try_from(level).unwrap_or(usize::MAX)).copied());
            let progress = counts.iter().find(|(wanted, _)| *wanted == key).map(|(_, value)| *value).filter(|_| target.is_some());
            Achievement { id: key, title, description: Some(description), unlocked_at: Some(0), progress, target, tier: tiered.then_some(level), tiers: tiered.then_some(TIERS), ..Achievement::default() }
        })
        .collect()
}

/// The player's level and experience from the summary (`Level: 53`, `Total XP: 17790419`), and the kilometers walked.
fn profile_in(text: &str) -> Vec<Reading> {
    let number = |name: &str| text.lines().find_map(|line| line.strip_prefix(name)).and_then(|value| value.trim().trim_end_matches("km").trim().parse::<f64>().ok());
    [("level", "Nivå", "Level:"), ("xp", "Erfaringspoeng", "Total XP:"), ("km", "Kilometer gått", "Distance walked:")]
        .into_iter()
        .filter_map(|(key, label, prefix)| Some(Reading { key, label, value: number(prefix)?, max: None }))
        .collect()
}

/// The days, in the owner's time, the app was launched, once each, oldest first.
fn launch_days_in(csv_text: &str) -> Result<Vec<NaiveDate>> {
    let mut reader = csv::ReaderBuilder::new().from_reader(csv_text.as_bytes());
    let headers = reader.headers().context("reading the sessions' header")?.clone();
    let (Some(event), Some(time)) = (headers.iter().position(|name| name == "Event_name"), headers.iter().position(|name| name == "Event_time")) else {
        bail!("App_Sessions.csv has no Event_name and Event_time columns")
    };
    let mut days: Vec<NaiveDate> = Vec::new();
    for record in reader.records() {
        let record = record.context("reading a session")?;
        if record.get(event) != Some("launch") {
            continue;
        }
        let Some(utc) = record.get(time).and_then(|text| NaiveDateTime::parse_from_str(text.trim_end_matches(" UTC"), "%Y-%m-%d %H:%M:%S").ok()) else { continue };
        days.push(DateTime::<chrono::Utc>::from_naive_utc_and_offset(utc, chrono::Utc).with_timezone(&Local).date_naive());
    }
    days.sort_unstable();
    days.dedup();
    Ok(days)
}

/// The log's lines: one for the start, and one for each day the game was opened. A line is added once, by its `source`.
fn entries_in(started: Option<NaiveDate>, days: &[NaiveDate]) -> Vec<Entry> {
    let line = |day: NaiveDate, source: String| Entry { on_date: Some(day.to_string()), title: TITLE.to_string(), status: "playing".to_string(), source: Some(source), ..Entry::default() };
    started.into_iter().map(|day| line(day, "pokemongo:start".to_string())).chain(days.iter().map(|day| line(*day, format!("pokemongo:{day}")))).collect()
}

/// The newest landed folder of the export, unless `POKEMON_GO_DIR` names one.
fn landed_folder() -> Result<PathBuf> {
    if let Some(folder) = std::env::var_os("POKEMON_GO_DIR") {
        return Ok(PathBuf::from(folder));
    }
    let root = Path::new("../../.data/raw/pokemon-go");
    let mut folders: Vec<PathBuf> = std::fs::read_dir(root).with_context(|| format!("reading {}: land the export with `npm run land -- pokemon-go <folder>`", root.display()))?.filter_map(|entry| Some(entry.ok()?.path())).filter(|path| path.is_dir()).collect();
    folders.sort();
    folders.pop().with_context(|| format!("{} holds no landed export", root.display()))
}

pub fn run(session: &Session) -> Result<()> {
    let folder = landed_folder()?;
    let gameplay = std::fs::read_to_string(folder.join("Gameplay.txt")).with_context(|| format!("reading Gameplay.txt in {}", folder.display()))?;
    let sessions = std::fs::read_to_string(folder.join("Player_Journey/App_Sessions.csv")).with_context(|| format!("reading Player_Journey/App_Sessions.csv in {}", folder.display()))?;
    let days = launch_days_in(&sessions)?;
    let entries = entries_in(started_in(&gameplay), &days);
    let added = session.shelf.append_new(&session.db, &session.log, &entries)?;
    let achievements = achievements_in(&gameplay);
    save(&session.db, "pokemongo", "start", &achievements)?;
    // The summary is a reading of the day it was made, which the landed folder's name tells.
    let day = folder.file_name().and_then(|name| name.to_str()).filter(|name| NaiveDate::parse_from_str(name, "%Y-%m-%d").is_ok()).map_or_else(profile::today, str::to_string);
    let readings = profile_in(&gameplay);
    profile::save(&session.db, "pokemongo", &day, &readings)?;
    println!("pokemon-go: {} days with a launch, {added} lines added to the log, {} achievements, {} readings of {day}", days.len(), achievements.len(), readings.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_start_is_the_summary_s_start_date() {
        assert_eq!(started_in("Level: 53\nStart date: 05/14/2017\nTotal XP: 1\n"), NaiveDate::from_ymd_opt(2017, 5, 14));
        assert_eq!(started_in("Level: 53\n"), None);
    }

    #[test]
    fn each_launch_day_is_one_line_and_only_launches_count() {
        let csv = "Event_time,Event_name,Region\n2024-12-01 13:59:39 UTC,launch,EU\n2024-12-01 15:00:00 UTC,launch,EU\n2024-12-02 09:00:00 UTC,install,EU\n2024-12-03 10:00:00 UTC,launch,EU\n";
        let days = launch_days_in(csv).unwrap_or_default();
        assert_eq!(days.len(), 2);
        let entries = entries_in(NaiveDate::from_ymd_opt(2017, 5, 14), &days);
        assert_eq!(entries.len(), 3);
        assert_eq!((entries[0].source.as_deref(), entries[0].status.as_str(), entries[0].amount), (Some("pokemongo:start"), "playing", None));
        assert_eq!(entries[1].source.as_deref(), Some("pokemongo:2024-12-01"));
    }

    #[test]
    fn each_medal_listed_is_an_achievement_with_its_tier_and_the_next_tier_s_threshold() {
        let text = "Level: 53\nDistance walked: 4198.167480 km\nYou have hatched 735 and currently have 7 eggs:\nYou have 3 medals:\n\tBadge: Win X Gym battles. where X is : 2\n\tBadge: km walked: : 3\n\tBADGE_MINI_COLLECTION: 23\n\tBADGE_NEVER_EARNED: 0\nStart date: 05/14/2017\n";
        let found = achievements_in(text);
        assert_eq!(found.iter().map(|achievement| achievement.title.as_str()).collect::<Vec<_>>(), vec!["Battle Girl", "Jogger", "Mini collection"]);
        assert_eq!(found[0].description.as_deref(), Some("Medalje i Pokémon GO, sølv: gymkamper vunnet"));
        // Silver of Battle Girl: gold asks 1000, and the summary does not say how many battles were won.
        assert_eq!((found[0].tier, found[0].tiers, found[0].target, found[0].progress), (Some(2), Some(4), Some(1000.0), None));
        // Gold of Jogger: platinum asks 10000, and the summary says 4198 km walked.
        assert_eq!((found[1].tier, found[1].target), (Some(3), Some(10_000.0)));
        assert!((found[1].progress.unwrap_or_default() - 4198.16748).abs() < 0.001);
        // A medal no table knows is only unlocked, with its count as the level.
        assert_eq!((found[2].description.as_deref(), found[2].tier, found[2].target), (Some("Medalje i Pokémon GO, nivå 23"), None, None));
        assert!(found.iter().all(|achievement| achievement.unlocked_at == Some(0)));
    }

    #[test]
    fn the_profile_is_the_level_the_experience_and_the_kilometers() {
        let readings = profile_in("Level: 53\nTotal XP: 17790419\nDistance walked: 4198.167480 km\n");
        assert_eq!(readings.iter().map(|reading| (reading.key, reading.value.trunc())).collect::<Vec<_>>(), vec![("level", 53.0), ("xp", 17_790_419.0), ("km", 4198.0)]);
        assert!(profile_in("nothing\n").is_empty());
    }

    #[test]
    fn a_file_without_the_columns_is_refused() {
        assert!(launch_days_in("a,b\n1,2\n").is_err());
    }
}
