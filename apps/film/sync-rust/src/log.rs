//! The film log: what the owner has watched, written by hand in `.data/film-log.csv` because there is no account to
//! fetch it from. One line per viewing, a `#` line a comment, an empty `watched_on` a viewing whose day is not known
//! and an empty `cinema` a film seen at home. The reading, the checking and the writing are
//! `shared_data::watch_log`, which the tv log shares; this file says which columns a film's line has.

use shared_data::watch_log::Log;

/// The film log: one line per viewing, as the file's header writes it.
pub const LOG: Log = Log {
    header: &["watched_on", "title", "year", "rating", "rewatch", "note", "tmdb_id", "cinema", "seat"],
    table: "film_watch",
    name: "film log",
    made_by: "film-sync add <title> <year> <date> <rating>",
    statuses: &[],
};

/// The film collection: what the owner has or wants, one line per film, written by hand in `.data/film-collection.csv`.
/// A film in it that the log also has is owned and seen; one it does not have is owned or wanted and not yet seen.
pub const COLLECTION: Log = Log {
    header: &["added_on", "title", "year", "status", "rating", "note", "tmdb_id", "format"],
    table: "film_collection",
    name: "film collection",
    made_by: "write .data/film-collection.csv by hand",
    statuses: &["owned", "want"],
};
