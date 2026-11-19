//! Whether a play being imported is one the database already has. Both importers
//! (Spotify's export and Last.fm) bring plays ListenBrainz may also have, started a
//! little apart, so a play counts as a twin when the same track started near it.

use std::collections::{HashMap, HashSet};

use anyhow::Result;
use shared_data::sqlite_client::SqliteClient;

/// Measured on the owner's data: 32 800 of the twins start within a minute of each
/// other and almost all the rest within six; further out is the same song replayed.
pub const TWIN_WINDOW_SECS: i64 = 360;

fn normalized(text: &str) -> String {
    text.trim().to_lowercase()
}

/// Start times of the listens already stored, by normalized track name.
#[derive(Debug, Default)]
pub struct Existing(HashMap<String, Vec<i64>>);

impl Existing {
    pub fn load(db: &SqliteClient) -> Result<Self> {
        let rows = db.query("SELECT listened_at, track_name FROM listens", &[])?;
        let mut existing = Existing::default();
        for row in rows {
            if let (Some(at), Some(track)) = (row["listened_at"].as_i64(), row["track_name"].as_str()) {
                existing.add(track, at);
            }
        }
        Ok(existing)
    }

    pub fn has_twin(&self, track: &str, started_at: i64) -> bool {
        self.0
            .get(&normalized(track))
            .is_some_and(|starts| starts.iter().any(|start| (start - started_at).abs() <= TWIN_WINDOW_SECS))
    }

    /// Pairs each play with at most one stored play of the same track within the window, the nearest pairs first, and
    /// uses the stored plays up: a song played twice in a row with one scrobble is one twin and one new play, and the
    /// stored play at a play's own second is never taken by a neighbour. Returns, per play, whether it has a twin.
    pub fn take_twins(&mut self, plays: &[(&str, i64)]) -> Vec<bool> {
        let mut pairs: Vec<(i64, usize, usize)> = Vec::new();
        for (play, (track, started_at)) in plays.iter().enumerate() {
            let Some(starts) = self.0.get(&normalized(track)) else { continue };
            for (stored, start) in starts.iter().enumerate() {
                let distance = (start - started_at).abs();
                if distance <= TWIN_WINDOW_SECS {
                    pairs.push((distance, play, stored));
                }
            }
        }
        pairs.sort_unstable();
        let mut twin = vec![false; plays.len()];
        let mut used: HashSet<(String, usize)> = HashSet::new();
        for (_, play, stored) in pairs {
            let track = normalized(plays[play].0);
            if !twin[play] && used.insert((track, stored)) {
                twin[play] = true;
            }
        }
        for (track, stored) in used {
            if let Some(starts) = self.0.get_mut(&track) {
                starts[stored] = i64::MIN;
            }
        }
        for starts in self.0.values_mut() {
            starts.retain(|start| *start != i64::MIN);
        }
        twin
    }

    /// Later plays of the same import are held to the same rule.
    pub fn add(&mut self, track: &str, started_at: i64) {
        self.0.entry(normalized(track)).or_default().push(started_at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_twin_is_case_and_space_insensitive() {
        let mut existing = Existing::default();
        existing.add("  Some Song ", 1_000);

        assert!(existing.has_twin("some song", 1_000));
        assert!(!existing.has_twin("another song", 1_000));
    }

    #[test]
    fn the_window_is_six_minutes_either_side() {
        let mut existing = Existing::default();
        existing.add("Song", 10_000);

        assert!(existing.has_twin("Song", 10_000 + TWIN_WINDOW_SECS));
        assert!(existing.has_twin("Song", 10_000 - TWIN_WINDOW_SECS));
        assert!(!existing.has_twin("Song", 10_000 + TWIN_WINDOW_SECS + 1));
        assert!(!existing.has_twin("Song", 10_000 - TWIN_WINDOW_SECS - 1));
    }

    #[test]
    fn a_stored_play_is_a_twin_to_one_play_only() {
        let mut existing = Existing::default();
        existing.add("Song", 10_000);

        assert_eq!(existing.take_twins(&[("Song", 10_000), ("Song", 10_180)]), vec![true, false]);
        assert_eq!(existing.take_twins(&[("Song", 10_000)]), vec![false], "the stored play is used up");
    }

    #[test]
    fn a_play_keeps_the_stored_play_at_its_own_second_when_an_earlier_one_is_near_too() {
        let mut existing = Existing::default();
        existing.add("Song", 10_200);

        assert_eq!(existing.take_twins(&[("Song", 10_100), ("Song", 10_200)]), vec![false, true]);
    }

    #[test]
    fn load_reads_the_stored_listens() {
        let db = SqliteClient::open(std::path::Path::new(":memory:")).unwrap();
        db.execute("CREATE TABLE listens (listened_at INTEGER, track_name TEXT)", &[]).unwrap();
        db.execute("INSERT INTO listens VALUES (5000, 'Stored Song')", &[]).unwrap();

        let existing = Existing::load(&db).unwrap();

        assert!(existing.has_twin("stored song", 5100));
    }
}
