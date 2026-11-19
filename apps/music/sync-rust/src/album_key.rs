//! What an album is. Scrobblers spell one album several ways ("B'Day", "B'Day (Deluxe Edition)", "Songs For You" and
//! "Songs for You"), so an album is not the exact release name and artist: every spelling gets a key, the spellings
//! with one key are one album, and the most played spelling (or the one the hand-written `music-albums.csv` names)
//! is how the album is called. `listens` is never rewritten; `album_variant` holds the answer.
//!
//! The file has the columns `artist,title,canonical_artist,canonical_title,release_mbid`. A line sends one
//! spelling to the album it really is; with no canonical title the spelling stays an album of its own, however
//! alike another looks. `release_mbid` pins the MusicBrainz release whose tracklist is the album's.

use crate::artist_alias::Aliases;
use crate::names::{fold, key_text, lead};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

/// A word that makes a trailing "(…)" or "- …" an edition of the album, not a different one.
const EDITION_WORDS: [&str; 9] = ["deluxe", "expanded", "platinum", "ultimate", "anniversary", "edition", "remaster", "bonus", "collector"];

/// An edition named at the end of a title with no bracket or dash: "B'Day Deluxe Edition".
const EDITION_SUFFIXES: [&str; 6] = [" deluxe edition", " expanded edition", " platinum edition", " ultimate edition", " deluxe version", " deluxe"];

/// The title without trailing edition tags: "B'Day (Deluxe Edition)" is "B'Day", "Album - 2011 Remaster" is "Album".
fn without_edition_tags(title: &str) -> &str {
    let mut title = title.trim();
    'again: loop {
        for delimiter in [" - ", " (", " ["] {
            if let Some(at) = title.rfind(delimiter) {
                let tail = title[at..].to_lowercase();
                let closed = delimiter == " - " || tail.trim_end().ends_with([')', ']']);
                if closed && EDITION_WORDS.iter().any(|word| tail.contains(word)) {
                    title = title[..at].trim_end();
                    continue 'again;
                }
            }
        }
        let lowered = title.to_lowercase();
        // Lowercasing keeps the byte length of these ASCII suffixes, so the cut is the same in `title`.
        match EDITION_SUFFIXES.iter().find(|suffix| lowered.ends_with(*suffix) && lowered.len() == title.len()) {
            Some(suffix) => title = title[..title.len() - suffix.len()].trim_end(),
            None => return title,
        }
    }
}

/// «(feat. Guest)» or «(Original Game Soundtrack)» at the end of an album's title: the guest is in the artist credit and
/// MusicBrainz names the soundtrack by the work alone.
fn is_guest_or_soundtrack_tag(tail: &str) -> bool {
    let tail = tail.trim().to_lowercase();
    tail.ends_with(')') && (["(feat", "(ft", "(with "].iter().any(|opening| tail.starts_with(opening)) || (tail.starts_with("(original") && tail.contains("soundtrack")))
}

/// The part of the album's title worth searching MusicBrainz for: no edition tags and no «- Single» or «(EP)» tail, which
/// MusicBrainz keeps in the release's kind and not its title.
pub fn album_search_title(title: &str) -> String {
    let mut title = without_edition_tags(title);
    'again: loop {
        title = title.trim_end_matches(':').trim_end();
        if let Some(at) = title.rfind(" (").filter(|at| is_guest_or_soundtrack_tag(&title[*at..])) {
            title = without_edition_tags(title[..at].trim_end());
            continue 'again;
        }
        let lowered = title.to_lowercase();
        for tail in [" - single", " - ep", " (single)", " (ep)", " [single]", " [ep]"] {
            // The tails are ASCII, so lowercasing keeps their byte length and the cut is the same in `title`.
            if lowered.ends_with(tail) {
                title = without_edition_tags(title[..title.len() - tail.len()].trim_end());
                continue 'again;
            }
        }
        return title.to_string();
    }
}

/// Two spellings with one key are one album.
pub fn album_key(artist: &str, title: &str) -> String {
    format!("{}\u{1f}{}", key_text(fold(lead(artist)), artist), key_text(fold(without_edition_tags(title)), title))
}

/// One line of `music-albums.csv`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fasit {
    pub artist: String,
    pub title: String,
    pub canonical_artist: String,
    pub canonical_title: String,
    pub release_mbid: String,
}

pub fn read_fasit(text: &str) -> Result<Vec<Fasit>> {
    let mut reader = csv::ReaderBuilder::new().comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let header = reader.headers().context("reading the header of music-albums.csv")?.clone();
    let column = |name: &str| header.iter().position(|found| found == name).with_context(|| format!("music-albums.csv has no «{name}» column"));
    let (artist, title, canonical_artist, canonical_title) = (column("artist")?, column("title")?, column("canonical_artist")?, column("canonical_title")?);
    let release_mbid = header.iter().position(|found| found == "release_mbid");
    let mut lines = Vec::new();
    for record in reader.records() {
        let record = record.context("reading a line of music-albums.csv")?;
        let get = |at: usize| record.get(at).unwrap_or_default().trim().to_string();
        let line = Fasit { artist: get(artist), title: get(title), canonical_artist: get(canonical_artist), canonical_title: get(canonical_title), release_mbid: release_mbid.map(get).unwrap_or_default() };
        if !line.artist.is_empty() && !line.title.is_empty() {
            lines.push(line);
        }
    }
    Ok(lines)
}

/// The file's lines, none when there is no file: the automatic key is enough until one is written.
pub fn load_fasit(path: &Path) -> Result<Vec<Fasit>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_fasit(&std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?)
}

/// A spelling heard in `listens`, with how often.
pub struct Spelling {
    pub album: String,
    pub artist: String,
    pub plays: i64,
}

/// A spelling and the album it belongs to.
#[derive(Debug, PartialEq, Eq)]
pub struct Variant {
    pub album: String,
    pub artist: String,
    pub canonical_album: String,
    pub canonical_artist: String,
    pub key: String,
    pub release_mbid: String,
}

/// The album of every spelling. A line of the file decides for the spelling it names (its album is the line's
/// canonical one, or its own when none is given); the rest fall in with the album of the same key, named by the
/// file when a line names it, otherwise by its most played spelling.
pub fn resolve(spellings: &[Spelling], fasit: &[Fasit], aliases: &Aliases) -> Vec<Variant> {
    let lines: HashMap<(String, String), &Fasit> = fasit.iter().map(|line| ((line.artist.clone(), line.title.clone()), line)).collect();
    let key_of = |spelling: &Spelling| match lines.get(&(spelling.artist.clone(), spelling.album.clone())) {
        Some(line) if line.canonical_title.is_empty() => format!("alone\u{1f}{}\u{1f}{}", spelling.artist, spelling.album),
        Some(line) => album_key(non_empty(&line.canonical_artist, &line.artist), &line.canonical_title),
        None => album_key(aliases.canonical(&spelling.artist), &spelling.album),
    };

    let mut groups: HashMap<String, Vec<&Spelling>> = HashMap::new();
    for spelling in spellings {
        groups.entry(key_of(spelling)).or_default().push(spelling);
    }

    let mut variants = Vec::with_capacity(spellings.len());
    for (key, members) in groups {
        let named = fasit.iter().find(|line| !line.canonical_title.is_empty() && album_key(non_empty(&line.canonical_artist, &line.artist), &line.canonical_title) == key);
        let top = members.iter().max_by(|a, b| a.plays.cmp(&b.plays).then_with(|| b.album.len().cmp(&a.album.len())).then_with(|| b.album.cmp(&a.album)));
        let (canonical_album, canonical_artist) = match (named, top) {
            (Some(line), _) => (line.canonical_title.clone(), non_empty(&line.canonical_artist, &line.artist).to_string()),
            (None, Some(top)) => (top.album.clone(), aliases.canonical(&top.artist).to_string()),
            (None, None) => continue,
        };
        let release_mbid = fasit.iter().filter(|line| !line.release_mbid.is_empty()).find(|line| members.iter().any(|member| member.artist == line.artist && member.album == line.title)).map(|line| line.release_mbid.clone()).unwrap_or_default();
        for member in members {
            variants.push(Variant { album: member.album.clone(), artist: member.artist.clone(), canonical_album: canonical_album.clone(), canonical_artist: canonical_artist.clone(), key: key.clone(), release_mbid: release_mbid.clone() });
        }
    }
    variants.sort_by(|a, b| (&a.artist, &a.album).cmp(&(&b.artist, &b.album)));
    variants
}

fn non_empty<'a>(preferred: &'a str, fallback: &'a str) -> &'a str {
    if preferred.is_empty() {
        fallback
    } else {
        preferred
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_search_title_drops_editions_and_single_tails() {
        assert_eq!(album_search_title("Animal (Expanded Edition)"), "Animal");
        assert_eq!(album_search_title("B'Day Deluxe Edition"), "B'Day");
        assert_eq!(album_search_title("Hypnotic - Single"), "Hypnotic");
        assert_eq!(album_search_title("Break My Soul (The Queens Remix) - EP"), "Break My Soul (The Queens Remix)");
        assert_eq!(album_search_title("Midnight Sun"), "Midnight Sun");
        assert_eq!(album_search_title("Cry (feat. Grimes)"), "Cry");
        assert_eq!(album_search_title("Donut County (Original Soundtrack)"), "Donut County");
        assert_eq!(album_search_title("After The Rain: Deluxe"), "After The Rain");
        assert_eq!(album_search_title("Baby (feat. MARINA & Luis Fonsi)"), "Baby");
        assert_eq!(album_search_title("Pride 2026 (DJ Mix)"), "Pride 2026 (DJ Mix)", "a DJ mix is its own release");
        assert_eq!(album_search_title("Brat (Deluxe) - Single"), "Brat");
    }

    fn spelling(album: &str, artist: &str, plays: i64) -> Spelling {
        Spelling { album: album.into(), artist: artist.into(), plays }
    }

    #[test]
    fn edition_tags_case_and_punctuation_do_not_make_another_album() {
        assert_eq!(album_key("Beyoncé", "B'Day"), album_key("Beyonce", "B'Day (Deluxe Edition)"));
        assert_eq!(album_key("Beyoncé", "B'Day"), album_key("Beyoncé", "B’Day"));
        assert_eq!(album_key("Tinashe", "Songs For You"), album_key("Tinashe", "Songs for You"));
        assert_eq!(album_key("Charli XCX", "Pop 2"), album_key("Charli xcx", "Pop 2"));
        assert_eq!(album_key("Band", "Album - 2011 Remaster"), album_key("Band", "Album"));
        assert_eq!(album_key("Band", "Album (Deluxe) [Remastered]"), album_key("Band", "Album"));
        assert_eq!(album_key("Beyoncé", "B'Day Deluxe Edition"), album_key("Beyoncé", "B'Day"));
    }

    #[test]
    fn another_title_artist_or_kind_of_release_is_another_album() {
        assert_ne!(album_key("Band", "Album"), album_key("Band", "Album 2"));
        assert_ne!(album_key("Band", "Album"), album_key("Other", "Album"));
        assert_ne!(album_key("Band", "Album"), album_key("Band", "Album - Single"));
        assert_ne!(album_key("Band", "Album"), album_key("Band", "Album (Live)"));
    }

    #[test]
    fn the_most_played_spelling_names_the_album_and_all_spellings_point_to_it() {
        let found = resolve(&[spelling("B'Day (Deluxe Edition)", "Beyoncé", 40), spelling("B'Day", "Beyoncé", 90), spelling("Other", "Beyoncé", 5)], &[], &Aliases::default());
        let deluxe = found.iter().find(|variant| variant.album == "B'Day (Deluxe Edition)").unwrap();
        assert_eq!((deluxe.canonical_album.as_str(), deluxe.canonical_artist.as_str()), ("B'Day", "Beyoncé"));
        assert_eq!(found.iter().find(|variant| variant.album == "Other").unwrap().canonical_album, "Other");
    }

    #[test]
    fn a_line_of_the_file_joins_spellings_the_key_cannot_and_names_the_album() {
        let fasit = read_fasit("artist,title,canonical_artist,canonical_title,release_mbid\nCardi B,AM I THE DRAMA? (Beat Edition),Cardi B,Am I the Drama?,rel-1\n").unwrap();
        let found = resolve(&[spelling("Am I the Drama?", "Cardi B", 10), spelling("AM I THE DRAMA? (Beat Edition)", "Cardi B", 50)], &fasit, &Aliases::default());
        assert_eq!(found[0].key, found[1].key);
        assert!(found.iter().all(|variant| variant.canonical_album == "Am I the Drama?" && variant.release_mbid == "rel-1"));
    }

    #[test]
    fn a_line_without_a_canonical_title_keeps_a_spelling_apart() {
        let fasit = read_fasit("artist,title,canonical_artist,canonical_title\nBand,Album (Deluxe),,\n").unwrap();
        let found = resolve(&[spelling("Album", "Band", 10), spelling("Album (Deluxe)", "Band", 5)], &fasit, &Aliases::default());
        assert_ne!(found[0].key, found[1].key);
    }

    #[test]
    fn the_file_is_optional_and_comments_are_skipped() {
        assert!(load_fasit(Path::new("/nonexistent/music-albums.csv")).unwrap().is_empty());
        assert_eq!(read_fasit("artist,title,canonical_artist,canonical_title\n# a note\nBand,Album,Band,Better\n").unwrap().len(), 1);
    }
}
