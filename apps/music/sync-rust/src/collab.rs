//! A listened name that is several artists ("Madonna & Sabrina Carpenter") counts for each of them. MusicBrainz' credit of
//! the recording says so (`credits.rs`); this is the fallback for a listen with no credit, deciding from the library alone.
//! A name is split on its separators only when every part is an artist that stands alone elsewhere, so a group such as
//! "Aly & AJ" (parts nobody plays alone) stays one, and so does any name MusicBrainz credits as one artist.

use crate::song_key::artist_key;
use std::collections::HashSet;

const SEPARATORS: [&str; 7] = [", ", " & ", " x ", " feat. ", " feat ", " ft. ", " featuring "];

/// The names between the separators of `name`, in order; one name when there is no separator.
fn parts_of(name: &str) -> Vec<&str> {
    let mut parts = vec![name];
    for separator in SEPARATORS {
        parts = parts.into_iter().flat_map(|part| part.split(separator)).collect();
    }
    parts.into_iter().map(str::trim).filter(|part| !part.is_empty()).collect()
}

/// Whether `name` has a separator at all, so an ordinary artist is never looked at.
pub fn looks_joined(name: &str) -> bool {
    SEPARATORS.iter().any(|separator| name.contains(separator))
}

/// The artists `name` is, or none when it is one: `alone` and `credited_as_one` are `artist_key`s of the artists heard
/// on their own and of the names MusicBrainz credits as a single artist.
pub fn split(name: &str, alone: &HashSet<String>, credited_as_one: &HashSet<String>) -> Vec<String> {
    if !looks_joined(name) || credited_as_one.contains(&artist_key(name)) {
        return Vec::new();
    }
    let parts = parts_of(name);
    let first_keys: HashSet<String> = parts.iter().map(|part| artist_key(part)).collect();
    if parts.len() < 2 || first_keys.len() < parts.len() || !parts.iter().all(|part| alone.contains(&artist_key(part))) {
        return Vec::new();
    }
    parts.into_iter().map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| artist_key(name)).collect()
    }

    #[test]
    fn a_name_is_split_only_when_every_part_is_an_artist_heard_alone() {
        let alone = keys(&["Madonna", "Sabrina Carpenter", "Aly", "Tinashe"]);
        assert_eq!(split("Madonna & Sabrina Carpenter", &alone, &HashSet::new()), ["Madonna", "Sabrina Carpenter"]);
        assert_eq!(split("Tinashe, Madonna feat. Aly", &alone, &HashSet::new()), ["Tinashe", "Madonna", "Aly"]);
        assert!(split("Aly & AJ", &alone, &HashSet::new()).is_empty(), "AJ is not heard alone");
        assert!(split("Madonna", &alone, &HashSet::new()).is_empty());
    }

    #[test]
    fn a_name_musicbrainz_credits_as_one_artist_is_never_split() {
        let alone = keys(&["Aly", "AJ"]);
        assert!(split("Aly & AJ", &alone, &keys(&["Aly & AJ"])).is_empty());
        assert_eq!(split("Aly & AJ", &alone, &HashSet::new()), ["Aly", "AJ"]);
    }
}
