//! The tv log: what the owner has watched, written by hand in `.data/tv-log.csv` because there is no account to fetch
//! it from. One line per episode, a `#` line a comment, an empty `watched_on` an episode whose day is not known and an
//! empty `season` or `episode` a viewing of the series as such. The reading, the checking and the writing are
//! `shared_data::watch_log`, which the film log shares; this file says which columns a series' line has.

use shared_data::watch_log::Log;

/// The tv log: one line per episode watched, as the file's header writes it.
pub const LOG: Log = Log {
    header: &["watched_on", "series", "year", "season", "episode", "rating", "rewatch", "note", "tmdb_id"],
    table: "tv_watch",
    name: "tv log",
    made_by: "tv-sync add <series> <year> <season> <episode> <date> <rating>",
    statuses: &[],
};

/// The tv collection: the series the owner has or wants, one line per series, written by hand in `.data/tv-collection.csv`.
pub const COLLECTION: Log = Log {
    header: &["added_on", "series", "year", "status", "rating", "note", "tmdb_id", "format"],
    table: "tv_collection",
    name: "tv collection",
    made_by: "write .data/tv-collection.csv by hand",
    statuses: &["owned", "want"],
};
