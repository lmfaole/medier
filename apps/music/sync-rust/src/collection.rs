//! The music collection: what the owner has or wants, written by hand in `.data/music-collection.csv` (`MUSIC_COLLECTION`
//! names another file): an artist, an album or a song a line, a `#` line a comment. The reading, the checking and the
//! writing are `shared_data::watch_log`, which the film and tv collections share; this file says which columns a music
//! line has.

use shared_data::watch_log::Log;

/// The music collection, as the file's header writes it. An artist's line has no title.
pub const COLLECTION: Log = Log {
    header: &["added_on", "kind", "artist", "title", "year", "status", "rating", "note", "mbid", "format"],
    table: "music_collection",
    name: "music collection",
    made_by: "write .data/music-collection.csv by hand",
    statuses: &["owned", "want"],
};
