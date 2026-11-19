//! Keeps the owner's games in the local database: what was played, from the log written by hand
//! (`.data/games-log.csv`, `GAMES_LOG` names another file) and from the Steam library, and what the register IGDB says
//! about each game. Run by hand from `apps/games` (`GAMES_DB` names another database file); the keys are
//! `STEAM_API_KEY`, `STEAM_ID`, `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, and `RA_USER` and `RA_API_KEY`, and `OPENXBL_API_KEY`.

mod achievement;
mod apple_games;
mod apple_tv;
mod igdb;
mod openxbl;
mod pokemon_go;
mod profile;
mod psn;
mod retroachievements;
mod romm;
mod schema;
mod steam;
mod steam_achievements;
mod trueachievements;

use anyhow::Result;
use shared_data::job::Job;
use shared_data::shelf::{Session, Shelf, Tool};

const TOOL: Tool = Tool {
    program: "games-sync",
    shelf: Shelf { prefix: "game", name: "games log", statuses: &["playing", "done", "dropped"], added_as: "done", overlay: None, made_by: "games-sync add <title> <year> <date> <rating>" },
    log: ("GAMES_LOG", "../../.data/games-log.csv"),
    collection: ("GAMES_COLLECTION", "../../.data/games-collection.csv"),
    database: ("GAMES_DB", "../../.data/games.db", "games"),
    schema: schema::SCHEMA,
};

fn main() -> Result<()> {
    TOOL.run(vec![
        Job::new("steam", "add the games of the Steam library that the log lacks, then import", |session: &Session, _| steam::run(session)),
        Job::new("steam-achievements", "keep the achievements of every Steam game that has hours", |session: &Session, _| steam_achievements::run(session)),
        Job::new("retroachievements", "add the RetroAchievements games the log lacks, then keep their achievements", |session: &Session, _| retroachievements::run(session)),
        Job::new("romm", "keep the ROMs of RomM and add each to the collection as owned", |session: &Session, _| romm::run(session)),
        Job::new("pokemon-go", "add a line to the log for every day Pokémon GO was opened, from the landed Niantic data export (`npm run land -- pokemon-go <folder>`)", |session: &Session, _| pokemon_go::run(session)),
        Job::new("purchases", "add the games of the receipts that mail-ingest landed (`npm run mail:purchases`) to the collection as owned", |session: &Session, _| shared_data::purchases::add(session, shared_data::purchases::Kind::Games)),
        Job::new("psn", "add the games of the PlayStation data report (landed by the Nextcloud repository) to the collection and the log", |session: &Session, _| psn::run(session)),
        Job::new("apple-tv", "add the games of the landed Apple data export (`npm run land -- apple <folder>`) to the collection as owned", |session: &Session, _| apple_tv::run(session)),
        Job::new("apple-games", "add the games of the landed Apple data export (`npm run land -- apple-media <zip>`, both parts): Game Center's and Apple Arcade's, to the collection and the log", |session: &Session, _| apple_games::run(session)),
        Job::new("xbox", "add the games and achievements of the landed TrueAchievements exports to the collection, the log and the achievements", |session: &Session, _| trueachievements::run(session)),
        Job::new("xbox-api", "keep the whole achievement list of every Xbox game the account has unlocked something in, from OpenXBL", |session: &Session, _| openxbl::run(session)),
        Job::new("igdb", "look up each game the log names in IGDB and fetch its details (--everything: all of them again)", |session, args| igdb::run(session, args.flag("--everything"))).flags(&["--everything"]),
    ])
}
