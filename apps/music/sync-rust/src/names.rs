//! When a name found by a lookup is the name that was listened to. A wrong match
//! writes a wrong id onto every play of the pair, so these rules lean towards
//! "no": accents, case, punctuation and a featured-artist tail do not matter; a
//! remix, a live version or a different artist does.

use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Where a featured artist starts in a credit; everything from here on is dropped.
const FEATURE_MARKERS: [&str; 5] = [" feat.", " feat ", " ft.", " ft ", " featuring "];

/// Lowercase letters and digits only, accents removed: "ROSALÍA" and "Rosalia" fold to the same text.
/// "&" reads as "and" first, so "Simon & Garfunkel" and "Simon and Garfunkel" agree.
pub(crate) fn fold(text: &str) -> String {
    text.replace('&', " and ")
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

/// The credit up to a featured artist: "Artist (feat. Guest)" is "Artist".
pub(crate) fn lead(credit: &str) -> &str {
    let lowered = credit.to_lowercase();
    let padded = format!("{lowered} ");
    let cut = FEATURE_MARKERS.iter().chain([&" (feat", &" [feat"]).filter_map(|marker| padded.find(marker)).min();
    // `lowered` and `credit` share byte offsets only when lowercasing keeps the length, which it does for these markers' ASCII.
    cut.and_then(|at| credit.get(..at)).unwrap_or(credit)
}

pub fn same_artist(listened: &str, credited: &str) -> bool {
    let (left, right) = (fold(lead(listened)), fold(lead(credited)));
    !left.is_empty() && left == right
}

/// A trailing "- Remastered 2011", "(2009 Remaster)" or "(feat. Guest)" names the same recording
/// (the guest is in the artist credit); any other tail ("Remix", "Live") does not.
fn without_edition_tag(title: &str) -> &str {
    for delimiter in [" - ", " (", " ["] {
        if let Some(at) = title.rfind(delimiter) {
            let tail = title[at..].to_lowercase();
            let featured = ["(feat", "[feat", "(with ", "[with ", "(ft", "[ft"].iter().any(|opening| tail.trim_start().starts_with(opening)) && tail.trim_end().ends_with([')', ']']);
            if tail.contains("remaster") || featured {
                return &title[..at];
            }
        }
    }
    title
}

/// The title before any bracket, dash, featured guest or «+ guest»: for matching inside one album's tracklist, where
/// «Hello - Live» and «Romeo + Ravyn Lenae» are the tracklist's «Hello» and «Romeo».
pub fn core_title(track: &str) -> &str {
    let lowered = track.to_lowercase();
    let cut = [" - ", " (", " [", " feat", " ft.", " with ", " + "].iter().filter_map(|delimiter| lowered.find(delimiter)).min();
    cut.and_then(|at| track.get(..at)).unwrap_or(track).trim()
}

/// What two spellings of a track's title share, for matching a play to a tracklist.
pub fn title_key(title: &str) -> String {
    key_text(fold(without_edition_tag(title)), title)
}

/// A name's letters and digits, or the name itself when it has none ("!!!"): so names with nothing to fold never meet.
pub fn key_text(folded: String, raw: &str) -> String {
    if folded.is_empty() {
        raw.trim().to_string()
    } else {
        folded
    }
}

pub fn same_title(listened: &str, found: &str) -> bool {
    let (left, right) = (fold(without_edition_tag(listened)), fold(without_edition_tag(found)));
    !left.is_empty() && left == right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_artist_folds_accents_case_and_punctuation() {
        assert!(same_artist("ROSALÍA", "Rosalia"));
        assert!(same_artist("Beyoncé", "BEYONCE"));
        assert!(same_artist("Charli xcx", "Charli XCX"));
        assert!(same_artist("St. Vincent", "St Vincent"));
        assert!(same_artist("Sigur Rós", "Sigur Ros"));
    }

    #[test]
    fn same_artist_ignores_a_featured_tail_on_either_side() {
        assert!(same_artist("Artist feat. Guest", "Artist"));
        assert!(same_artist("Artist", "Artist (feat. Guest)"));
        assert!(same_artist("Artist ft. Guest", "Artist featuring Other"));
    }

    #[test]
    fn same_artist_reads_and_as_an_ampersand() {
        assert!(same_artist("Simon & Garfunkel", "Simon and Garfunkel"));
    }

    #[test]
    fn a_different_artist_or_a_name_with_nothing_to_compare_does_not_match() {
        assert!(!same_artist("Artist A", "Artist B"));
        assert!(!same_artist("Queen", "Queen Latifah"));
        assert!(!same_artist("!!!", "???"));
        assert!(!same_artist("", ""));
    }

    #[test]
    fn same_title_ignores_a_featured_artist_in_brackets() {
        assert!(same_title("STUPID (feat. Yung Baby Tate)", "STUPID"));
        assert!(same_title("Song [feat. Guest]", "Song"));
        assert!(same_title("Song (with Guest)", "Song"));
        assert!(!same_title("Song (feat. Guest) - Live", "Song"));
    }

    #[test]
    fn same_title_ignores_a_remaster_tag_but_not_a_remix_or_a_live_version() {
        assert!(same_title("Song - Remastered 2011", "Song"));
        assert!(same_title("Song (2009 Remaster)", "Song"));
        assert!(same_title("Don't Stop", "Dont Stop"));
        assert!(!same_title("Song - Remix", "Song"));
        assert!(!same_title("Song (Live)", "Song"));
        assert!(!same_title("Song Part 2", "Song"));
    }
}
