//! The tracks of an album page: with a tracklist, every track in the album's order and what is known of each (length,
//! when it was first and last played, loved, genres, a credit that is not the album's artist); without one, what was
//! played, most played first. A fact nothing knows is left out of the track, not written as an empty value.

use crate::names::{core_title, fold, title_key};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const LISTED_TRACKS: usize = 40;
const TRACK_GENRES: usize = 3;

/// A track of the album's tracklist.
pub struct Listed {
    pub disc: i64,
    pub position: i64,
    pub title: String,
    pub recording_mbid: Option<String>,
    pub length_ms: Option<i64>,
    pub artist_credit: Option<String>,
}

/// A track that was played, as the plays of it under one name add up.
pub struct Heard {
    pub track: String,
    pub recording_mbid: Option<String>,
    pub plays: i64,
    pub first_at: i64,
    pub last_at: i64,
    pub length_ms: Option<i64>,
    pub release_year: Option<i64>,
    pub loved: bool,
    pub genres: Vec<(String, i64)>,
}

/// What is known of one track, from the tracklist and from the plays that matched it.
#[derive(Default)]
struct Facts {
    plays: i64,
    first_at: Option<i64>,
    last_at: Option<i64>,
    length_ms: Option<i64>,
    release_year: Option<i64>,
    loved: bool,
    genres: HashMap<String, i64>,
}

impl Facts {
    fn add(&mut self, play: &Heard) {
        self.plays += play.plays;
        self.first_at = Some(self.first_at.map_or(play.first_at, |at| at.min(play.first_at)));
        self.last_at = Some(self.last_at.map_or(play.last_at, |at| at.max(play.last_at)));
        self.length_ms = self.length_ms.max(play.length_ms);
        self.release_year = self.release_year.max(play.release_year);
        self.loved |= play.loved;
        for (genre, plays) in &play.genres {
            *self.genres.entry(genre.clone()).or_default() += plays;
        }
    }

    /// The track as JSON: its name, plays and whichever of the rest is known. A release year is only worth showing
    /// when it is not the album's (a single, a bonus track).
    fn json(&self, track: &str, album_year: Option<i64>, tracklist: Option<&Listed>, album_artist: &str) -> Value {
        let mut entry = Map::new();
        entry.insert("track".into(), json!(track));
        entry.insert("plays".into(), json!(self.plays));
        if let Some(listed) = tracklist {
            entry.insert("disc".into(), json!(listed.disc));
            entry.insert("position".into(), json!(listed.position));
            if let Some(credit) = listed.artist_credit.as_deref().filter(|credit| fold(credit) != fold(album_artist)) {
                entry.insert("credit".into(), json!(credit));
            }
        }
        let length = tracklist.and_then(|listed| listed.length_ms).or(self.length_ms);
        for (name, value) in [("length_ms", length), ("first_at", self.first_at), ("last_at", self.last_at), ("release_year", self.release_year.filter(|year| Some(*year) != album_year))] {
            if let Some(value) = value {
                entry.insert(name.into(), json!(value));
            }
        }
        if self.loved {
            entry.insert("loved".into(), json!(true));
        }
        let mut genres: Vec<(&String, &i64)> = self.genres.iter().collect();
        genres.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        if !genres.is_empty() {
            entry.insert("genres".into(), json!(genres.into_iter().take(TRACK_GENRES).map(|(genre, _)| genre).collect::<Vec<_>>()));
        }
        Value::Object(entry)
    }
}

/// The album's tracks and how many of them were heard. With a tracklist, every track in the album's order (a track
/// not played has no plays), then the played tracks that are not on it, most played first; without one, what was
/// played, most played first.
pub fn tracks_json(mut heard: Vec<Heard>, listed: &[Listed], album_artist: &str, album_year: Option<i64>) -> (usize, Vec<Value>) {
    heard.sort_by(|a, b| b.plays.cmp(&a.plays).then_with(|| a.track.cmp(&b.track)));
    let facts_of = |play: &Heard| {
        let mut facts = Facts::default();
        facts.add(play);
        facts
    };
    if listed.is_empty() {
        let count = heard.len();
        return (count, heard.iter().take(LISTED_TRACKS).map(|play| facts_of(play).json(&play.track, album_year, None, album_artist)).collect());
    }
    let mut taken = vec![false; heard.len()];
    let mut found: Vec<Facts> = listed.iter().map(|_| Facts::default()).collect();
    for (track, facts) in listed.iter().zip(found.iter_mut()) {
        let wanted = title_key(&track.title);
        for (index, play) in heard.iter().enumerate() {
            let same = !taken[index] && (play.recording_mbid.is_some() && play.recording_mbid == track.recording_mbid || title_key(&play.track) == wanted);
            if same {
                taken[index] = true;
                facts.add(play);
            }
        }
    }
    // What is left by its core title: «Sorry - Homecoming Live» and «Sorry (Homecoming Live)» are the live album's «Sorry».
    // Only a core title one track of the list has, so two tracks that share one («Intro», «Intro (Reprise)») take nothing.
    let cores: Vec<String> = listed.iter().map(|track| fold(core_title(&track.title))).collect();
    for (index, play) in heard.iter().enumerate() {
        if taken[index] {
            continue;
        }
        let core = fold(core_title(&play.track));
        let mut matching = cores.iter().enumerate().filter(|(_, listed)| !core.is_empty() && **listed == core);
        if let (Some((at, _)), None) = (matching.next(), matching.next()) {
            taken[index] = true;
            found[at].add(play);
        }
    }
    let mut tracks = Vec::new();
    let mut heard_count = 0;
    for (track, facts) in listed.iter().zip(found) {
        heard_count += usize::from(facts.plays > 0);
        tracks.push(facts.json(&track.title, album_year, Some(track), album_artist));
    }
    for (play, _) in heard.iter().zip(taken).filter(|(_, taken)| !taken) {
        heard_count += 1;
        tracks.push(facts_of(play).json(&play.track, album_year, None, album_artist));
    }
    (heard_count, tracks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heard(track: &str, mbid: Option<&str>, plays: i64) -> Heard {
        Heard { track: track.into(), recording_mbid: mbid.map(str::to_string), plays, first_at: 100, last_at: 200, length_ms: None, release_year: None, loved: false, genres: Vec::new() }
    }

    fn listed(position: i64, title: &str, mbid: Option<&str>) -> Listed {
        Listed { disc: 1, position, title: title.into(), recording_mbid: mbid.map(str::to_string), length_ms: None, artist_credit: None }
    }

    #[test]
    fn a_tracklist_gives_every_track_in_the_albums_order_and_the_played_extras_after() {
        let tracks = [heard("Second (feat. Guest)", None, 5), heard("Renamed", Some("r3"), 2), heard("Bonus", None, 9), heard("First", None, 1), heard("First", None, 3)];
        let (heard_count, found) = tracks_json(tracks.into(), &[listed(1, "First", None), listed(2, "Second", None), listed(3, "Third", Some("r3")), listed(4, "Never played", None)], "Band", None);
        let summary: Vec<(String, i64)> = found.iter().map(|track| (track["track"].as_str().unwrap().to_string(), track["plays"].as_i64().unwrap())).collect();
        assert_eq!(summary, vec![("First".into(), 4), ("Second".into(), 5), ("Third".into(), 2), ("Never played".into(), 0), ("Bonus".into(), 9)]);
        assert_eq!(heard_count, 4);
        assert_eq!(found[4].get("position"), None);
        assert_eq!(found[3].get("first_at"), None);
    }

    #[test]
    fn a_live_spelling_is_the_track_whose_core_title_it_shares_when_only_one_has_it() {
        let tracks = vec![heard("Sorry - Homecoming Live", None, 5), heard("Sorry (Homecoming Live)", None, 1), heard("Intro (Live)", None, 2)];
        let list = [listed(1, "Sorry", None), listed(2, "Intro", None), listed(3, "Intro (Reprise)", None)];
        let (heard_count, found) = tracks_json(tracks, &list, "Band", None);
        let summary: Vec<(String, i64)> = found.iter().map(|track| (track["track"].as_str().unwrap().to_string(), track["plays"].as_i64().unwrap())).collect();
        assert_eq!(summary, vec![("Sorry".into(), 6), ("Intro".into(), 0), ("Intro (Reprise)".into(), 0), ("Intro (Live)".into(), 2)]);
        assert_eq!(heard_count, 2);
    }

    #[test]
    fn without_a_tracklist_the_played_tracks_come_most_played_first() {
        let (heard_count, found) = tracks_json(vec![heard("A", None, 1), heard("B", None, 3)], &[], "Band", None);
        assert_eq!((heard_count, found[0]["track"].as_str()), (2, Some("B")));
    }

    #[test]
    fn a_track_carries_what_is_known_of_it_and_nothing_else() {
        let mut play = heard("One", None, 2);
        play.length_ms = Some(200_000);
        play.release_year = Some(2019);
        play.loved = true;
        play.genres = vec![("pop".into(), 2), ("rnb".into(), 5), ("soul".into(), 1), ("funk".into(), 1)];
        let mut track = listed(1, "One", None);
        track.length_ms = Some(201_000);
        track.artist_credit = Some("Band feat. Guest".into());
        let (_, found) = tracks_json(vec![play, heard("Two", None, 1)], &[track], "Band", Some(2001));
        assert_eq!(found[0], json!({ "track": "One", "plays": 2, "disc": 1, "position": 1, "credit": "Band feat. Guest", "length_ms": 201_000, "first_at": 100, "last_at": 200, "release_year": 2019, "loved": true, "genres": ["rnb", "pop", "funk"] }));
        assert_eq!(found[1], json!({ "track": "Two", "plays": 1, "first_at": 100, "last_at": 200 }));
    }

    #[test]
    fn a_credit_that_is_the_albums_artist_and_the_albums_own_year_are_not_repeated_on_the_track() {
        let mut play = heard("One", None, 1);
        play.release_year = Some(2001);
        let mut track = listed(1, "One", None);
        track.artist_credit = Some("BAND".into());
        let (_, found) = tracks_json(vec![play], &[track], "Band", Some(2001));
        assert_eq!(found[0].get("credit"), None);
        assert_eq!(found[0].get("release_year"), None);
    }
}
