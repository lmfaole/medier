//! The address of an entity's page and file: its ASCII letters and digits,
//! then a hash of the whole name, so a name with no ASCII (or two that differ
//! only in accents) still gets a distinct, URL- and file-safe slug.

/// The longest readable part of a slug, so an album with a long title stays a short file name.
const MAX_WORDS: usize = 40;

pub fn slug(name: &str) -> String {
    slug_of(&[name])
}

/// The slug of something named by several parts, an album and its artist: the
/// words read from all of them, the hash over them kept apart.
pub fn slug_of(parts: &[&str]) -> String {
    let mut words = String::new();
    for character in parts.join(" ").chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            words.push(character);
        } else if !words.ends_with('-') && !words.is_empty() {
            words.push('-');
        }
    }
    words.truncate(MAX_WORDS);
    let hash = parts.join("\u{1f}").bytes().fold(0x811c_9dc5_u32, |hash, byte| (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193));
    let words = words.trim_end_matches('-');
    if words.is_empty() {
        format!("{hash:08x}")
    } else {
        format!("{words}-{hash:08x}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slug_is_safe_for_a_url_and_a_file_name_and_tells_names_apart() {
        let safe = |slug: &str| slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        for name in ["Lady Gaga", "AC/DC", "Röyksopp", "坂本龍一", "", "  !! "] {
            let slug = slug(name);
            assert!(safe(&slug), "{slug}");
            assert!(!slug.is_empty());
        }
        assert!(slug("Lady Gaga").starts_with("lady-gaga-"));
        assert_ne!(slug("Röyksopp"), slug("Royksopp"));
        assert_eq!(slug("AC/DC"), slug("AC/DC"));
    }

    #[test]
    fn parts_are_hashed_apart_so_where_a_name_splits_matters() {
        assert_ne!(slug_of(&["a b", "c"]), slug_of(&["a", "b c"]));
        assert!(slug_of(&["Renaissance", "Beyoncé"]).starts_with("renaissance-beyonc"));
    }

    #[test]
    fn a_long_title_keeps_the_slug_short() {
        assert!(slug(&"word ".repeat(40)).len() <= 40 + 9);
    }
}
