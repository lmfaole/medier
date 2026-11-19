//! Text helpers the data tools share.

use unicode_normalization::UnicodeNormalization;

/// The letters and digits of a name, lowercase and without accents: two spellings of one title are equal.
#[must_use]
pub fn normalize(text: &str) -> String {
    text.replace(['ø', 'Ø'], "o").replace(['æ', 'Æ'], "ae").nfkd().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The letters and digits of a name, at most forty of them: a slug two spellings of one title share.
#[must_use]
pub fn slug(text: &str) -> String {
    let letters: String = normalize(text).chars().take(40).collect();
    if letters.is_empty() {
        "x".to_string()
    } else {
        letters
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize, slug};

    #[test]
    fn two_spellings_of_a_title_are_equal_and_two_titles_are_not() {
        assert_eq!(normalize("Dagsnytt 18!"), normalize("dagsnytt-18"));
        assert_eq!(normalize("Ål & Øl"), normalize("al ol"));
        assert_ne!(normalize("Debatten"), normalize("Debatten Extra"));
    }

    #[test]
    fn a_slug_is_short_and_never_empty() {
        assert_eq!(slug("Så vidt!"), "savidt");
        assert_eq!(slug("Å"), "a");
        assert_eq!(slug(" - "), "x");
        assert_eq!(slug(&"a".repeat(60)).len(), 40);
    }
}
