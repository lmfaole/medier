//! What counts as music. `listens` holds music only: `split-podcasts` moves the plays of a podcast to
//! `.data/podcasts.db` (see `podcasts.rs`). What stays here as a guard is the clip a scrobbler logs with
//! its headline as the artist, with no album and no MusicBrainz recording and ten minutes or more, which
//! can arrive between two splits and must not move the top artists, the listening clock or the streaks.
//! `MUSIC_ONLY_SQL` in `packages/contracts/src/music-tables.ts` is the same condition for the Workers,
//! and `contracts.test.ts` holds the two equal.

/// The WHERE condition that keeps a listen if it is music, as a literal, so it
/// can be spliced into a `concat!` of a constant query as well as a `format!`.
macro_rules! music_only {
    () => {
        "(listens.release_name IS NOT NULL OR listens.recording_mbid IS NOT NULL OR COALESCE(listens.duration_ms, 0) < 600000)"
    };
}
pub(crate) use music_only;

pub(crate) const MUSIC_ONLY: &str = music_only!();
