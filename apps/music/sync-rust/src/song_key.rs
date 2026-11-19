//! What an artist and a song are, as `album_key.rs` does for albums: scrobblers spell one artist or one song several
//! ways ("Charli XCX"/"Charli xcx", "Die A Little Bit"/"Die a Little Bit"), so every spelling gets a key, spellings
//! with one key are one artist or one song, and the most played spelling is how it is called. A featured tail on an
//! artist and a remaster or "(feat. …)" tag on a title are folded away; a remix or a live version is not.

use crate::artist_alias::Aliases;
use crate::names::{fold, key_text, lead, title_key};
use std::collections::HashMap;

pub fn artist_key(artist: &str) -> String {
    key_text(fold(lead(artist)), artist)
}

pub fn song_key(artist: &str, track: &str) -> String {
    format!("{}\u{1f}{}", artist_key(artist), title_key(track))
}

/// A spelling of an artist heard in `listens`, with how often.
pub struct ArtistSpelling {
    pub artist: String,
    pub plays: i64,
}

/// A spelling of a song heard in `listens`, with how often.
pub struct SongSpelling {
    pub artist: String,
    pub track: String,
    pub plays: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ArtistVariant {
    pub artist: String,
    pub display: String,
    pub key: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SongVariant {
    pub artist: String,
    pub track: String,
    pub name: String,
    pub key: String,
}

/// The most played of `names` with their plays; a tie goes to the shorter, then the alphabetically first.
fn most_played<'a>(names: &[(&'a str, i64)]) -> Option<&'a str> {
    names.iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.len().cmp(&a.0.len())).then_with(|| b.0.cmp(a.0))).map(|(name, _)| *name)
}

/// A renamed artist is called by the name the alias file gives, not by the most played spelling.
pub fn resolve_artists(spellings: &[ArtistSpelling], aliases: &Aliases) -> Vec<ArtistVariant> {
    let mut groups: HashMap<String, Vec<&ArtistSpelling>> = HashMap::new();
    for spelling in spellings {
        groups.entry(artist_key(aliases.canonical(&spelling.artist))).or_default().push(spelling);
    }
    let mut variants = Vec::with_capacity(spellings.len());
    for (key, members) in groups {
        let names: Vec<(&str, i64)> = members.iter().map(|member| (member.artist.as_str(), member.plays)).collect();
        let renamed = members.iter().find_map(|member| aliases.replacement(&member.artist));
        let display = renamed.or_else(|| most_played(&names)).unwrap_or_default();
        variants.extend(members.iter().map(|member| ArtistVariant { artist: member.artist.clone(), display: display.to_string(), key: key.clone() }));
    }
    variants.sort_by(|a, b| a.artist.cmp(&b.artist));
    variants
}

pub fn resolve_songs(spellings: &[SongSpelling], aliases: &Aliases) -> Vec<SongVariant> {
    let mut groups: HashMap<String, Vec<&SongSpelling>> = HashMap::new();
    for spelling in spellings {
        groups.entry(song_key(aliases.canonical(&spelling.artist), &spelling.track)).or_default().push(spelling);
    }
    let mut variants = Vec::with_capacity(spellings.len());
    for (key, members) in groups {
        // Plays of one title under several artist spellings count together, so the title is the most played overall.
        let mut by_title: HashMap<&str, i64> = HashMap::new();
        for member in &members {
            *by_title.entry(member.track.as_str()).or_default() += member.plays;
        }
        let titles: Vec<(&str, i64)> = by_title.into_iter().collect();
        let name = most_played(&titles).unwrap_or_default();
        variants.extend(members.iter().map(|member| SongVariant { artist: member.artist.clone(), track: member.track.clone(), name: name.to_string(), key: key.clone() }));
    }
    variants.sort_by(|a, b| (&a.artist, &a.track).cmp(&(&b.artist, &b.track)));
    variants
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song(artist: &str, track: &str, plays: i64) -> SongSpelling {
        SongSpelling { artist: artist.into(), track: track.into(), plays }
    }

    #[test]
    fn case_accents_and_a_featured_tail_are_one_artist_but_another_name_is_not() {
        assert_eq!(artist_key("Charli XCX"), artist_key("Charli xcx"));
        assert_eq!(artist_key("Beyoncé"), artist_key("Beyonce feat. Jay-Z"));
        assert_ne!(artist_key("Queen"), artist_key("Queen Latifah"));
        assert_ne!(artist_key("!!!"), artist_key("???"));
    }

    #[test]
    fn case_and_a_remaster_or_feature_tag_are_one_song_but_a_remix_or_live_version_is_not() {
        assert_eq!(song_key("Tinashe", "Die A Little Bit"), song_key("tinashe", "Die a Little Bit"));
        assert_eq!(song_key("Band", "Song - Remastered 2011"), song_key("Band", "Song"));
        assert_eq!(song_key("Band", "Song (feat. Guest)"), song_key("Band", "Song"));
        assert_ne!(song_key("Band", "Song"), song_key("Band", "Song (Live)"));
        assert_ne!(song_key("Band", "Song"), song_key("Other", "Song"));
    }

    #[test]
    fn the_most_played_spelling_names_the_artist_and_the_song() {
        let artists = resolve_artists(&[ArtistSpelling { artist: "Charli xcx".into(), plays: 664 }, ArtistSpelling { artist: "Charli XCX".into(), plays: 18 }], &Aliases::default());
        assert!(artists.iter().all(|variant| variant.display == "Charli xcx"));
        let songs = resolve_songs(&[song("Tinashe", "Die A Little Bit", 20), song("Tinashe", "Die a Little Bit", 120), song("Tinashe", "Other", 1)], &Aliases::default());
        assert_eq!(songs.iter().filter(|variant| variant.name == "Die a Little Bit").count(), 2);
        assert_eq!(songs.iter().find(|variant| variant.track == "Other").unwrap().name, "Other");
    }

    #[test]
    fn a_renamed_artist_and_its_songs_join_under_the_new_name_even_when_the_old_one_was_played_more() {
        let aliases = Aliases::new(&[crate::artist_alias::AliasLine { alias: "Marina and the Diamonds".into(), canonical: "MARINA".into() }]);
        let artists = resolve_artists(&[ArtistSpelling { artist: "Marina and the Diamonds".into(), plays: 900 }, ArtistSpelling { artist: "MARINA".into(), plays: 40 }], &aliases);
        assert_eq!(artists[0].key, artists[1].key);
        assert!(artists.iter().all(|variant| variant.display == "MARINA"));
        let songs = resolve_songs(&[song("Marina and the Diamonds", "Primadonna", 70), song("MARINA", "Primadonna", 5)], &aliases);
        assert_eq!(songs[0].key, songs[1].key);
    }
}
