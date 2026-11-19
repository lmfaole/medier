//! Keeps the owner's board games in the local database: which games were played, from the log written by hand
//! (`.data/boardgames-log.csv`, `BOARDGAMES_LOG` names another file; a game, not each round of it), and what the
//! register `BoardGameGeek` says about each game. Run by hand from `apps/boardgames` (`BOARDGAMES_DB` names another
//! database file); the register's key is `BGG_TOKEN`.

mod bgg;
mod schema;

use anyhow::Result;
use shared_data::job::Job;
use shared_data::shelf::{Session, Shelf, Tool};

const TOOL: Tool = Tool {
    program: "boardgames-sync",
    shelf: Shelf { prefix: "boardgame", name: "board games log", statuses: &["played"], added_as: "played", overlay: None, made_by: "boardgames-sync add <title> <year> <date> <rating>" },
    log: ("BOARDGAMES_LOG", "../../.data/boardgames-log.csv"),
    collection: ("BOARDGAMES_COLLECTION", "../../.data/boardgames-collection.csv"),
    database: ("BOARDGAMES_DB", "../../.data/boardgames.db", "boardgames"),
    schema: schema::SCHEMA,
};

fn main() -> Result<()> {
    TOOL.run(vec![
        Job::new("bgg", "look up each game the log names on BoardGameGeek and fetch its details (--everything: all of them again)", |session: &Session, args| bgg::run(session, args.flag("--everything"))).flags(&["--everything"]),
    ])
}
