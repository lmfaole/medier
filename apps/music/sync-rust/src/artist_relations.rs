//! How the artist pages relate artists to each other: who each was heard with on one recording, and who sounds alike.
//! Both are worked out from the library alone, so they say what this library holds, not what the world thinks.

use std::collections::{BTreeMap, HashMap};

/// One artist of one listen. The listens of a collaboration share `listened_at`, `track` and `credited_as`.
pub struct ArtistOfListen {
    pub listened_at: i64,
    pub track: String,
    pub credited_as: String,
    pub artist: String,
}

/// An artist heard together with another: how often, and on which tracks (most played first).
#[derive(Debug, PartialEq, Eq)]
pub struct Collaborator {
    pub artist: String,
    pub plays: i64,
    pub tracks: Vec<(String, i64)>,
}

/// For every artist, everyone heard with them, the most played together first. Each listen counts once per pair.
pub fn collaborations(rows: &[ArtistOfListen]) -> HashMap<String, Vec<Collaborator>> {
    let mut listens: BTreeMap<(i64, &str, &str), Vec<&str>> = BTreeMap::new();
    for row in rows {
        let artists = listens.entry((row.listened_at, row.track.as_str(), row.credited_as.as_str())).or_default();
        if !artists.contains(&row.artist.as_str()) {
            artists.push(&row.artist);
        }
    }
    let mut pairs: HashMap<&str, HashMap<&str, HashMap<&str, i64>>> = HashMap::new();
    for ((_, track, _), artists) in &listens {
        for artist in artists {
            for other in artists.iter().filter(|other| *other != artist) {
                *pairs.entry(artist).or_default().entry(other).or_default().entry(track).or_default() += 1;
            }
        }
    }
    pairs
        .into_iter()
        .map(|(artist, others)| {
            let mut list: Vec<Collaborator> = others
                .into_iter()
                .map(|(other, tracks)| {
                    let mut tracks: Vec<(String, i64)> = tracks.into_iter().map(|(track, plays)| (track.to_string(), plays)).collect();
                    tracks.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
                    Collaborator { artist: other.to_string(), plays: tracks.iter().map(|track| track.1).sum(), tracks }
                })
                .collect();
            list.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.artist.cmp(&b.artist)));
            (artist.to_string(), list)
        })
        .collect()
}

fn norm(vector: &HashMap<&str, f64>) -> f64 {
    vector.values().map(|value| value * value).sum::<f64>().sqrt()
}

/// Every pair of artists whose genres overlap at least `minimum` (cosine of the plays per genre), most alike first. The
/// genres are those of the recordings heard, so two artists are alike when the library files them under the same labels.
pub fn similar(genres: &HashMap<String, Vec<(String, i64)>>, minimum: f64) -> HashMap<String, Vec<(String, f64)>> {
    let vectors: Vec<(&String, HashMap<&str, f64>)> = genres.iter().map(|(artist, list)| (artist, list.iter().map(|(genre, plays)| (genre.as_str(), f64::from(i32::try_from(*plays).unwrap_or(i32::MAX)))).collect())).collect();
    let mut found: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for (at, (artist, vector)) in vectors.iter().enumerate() {
        let length = norm(vector);
        if length == 0.0 {
            continue;
        }
        for (other, other_vector) in &vectors[at + 1..] {
            let other_length = norm(other_vector);
            let dot: f64 = vector.iter().filter_map(|(genre, plays)| other_vector.get(genre).map(|other_plays| plays * other_plays)).sum();
            let score = if other_length == 0.0 { 0.0 } else { dot / (length * other_length) };
            if score >= minimum {
                found.entry((*artist).clone()).or_default().push(((*other).clone(), score));
                found.entry((*other).clone()).or_default().push(((*artist).clone(), score));
            }
        }
    }
    for list in found.values_mut() {
        list.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credited(at: i64, track: &str, artist: &str) -> ArtistOfListen {
        ArtistOfListen { listened_at: at, track: track.into(), credited_as: "A & B".into(), artist: artist.into() }
    }

    #[test]
    fn each_artist_of_a_listen_is_heard_with_the_others_and_a_repeat_is_counted_once() {
        let rows = [credited(1, "Song", "A"), credited(1, "Song", "B"), credited(1, "Song", "B"), credited(2, "Song", "A"), credited(2, "Song", "B"), credited(3, "Other", "A"), credited(3, "Other", "B")];
        let found = collaborations(&rows);
        assert_eq!(found["A"], [Collaborator { artist: "B".into(), plays: 3, tracks: vec![("Song".into(), 2), ("Other".into(), 1)] }]);
        assert_eq!(found["B"][0].artist, "A");
    }

    #[test]
    fn artists_are_alike_by_the_overlap_of_their_genres_and_nobody_is_alike_with_nothing() {
        let genres = HashMap::from([
            ("Pop one".to_string(), vec![("pop".to_string(), 10), ("dance".to_string(), 5)]),
            ("Pop two".to_string(), vec![("pop".to_string(), 4), ("dance".to_string(), 2)]),
            ("Metal".to_string(), vec![("metal".to_string(), 9)]),
            ("Unknown".to_string(), vec![]),
        ]);
        let found = similar(&genres, 0.6);
        assert_eq!(found["Pop one"].len(), 1);
        assert_eq!(found["Pop one"][0].0, "Pop two");
        assert!(!found.contains_key("Metal") && !found.contains_key("Unknown"));
    }
}
