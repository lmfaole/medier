//! An artist that changed its name ("Marina and the Diamonds" became "MARINA"). Last.fm sends the name the artist had
//! when it was scrobbled, and no spelling rule joins two names, so the hand-written `music-artists.csv` (columns
//! `alias_name,canonical_name`) says which name is the artist's today. `listens` is never rewritten; the alias is
//! applied where `artist_variant`, `song_variant` and `album_variant` are made.

use crate::song_key::artist_key;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

/// One line of `music-artists.csv`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AliasLine {
    pub alias: String,
    pub canonical: String,
}

/// The names to replace, found by `artist_key` so "marina and the diamonds" is caught too.
#[derive(Debug, Default)]
pub struct Aliases {
    by_key: HashMap<String, String>,
}

impl Aliases {
    pub fn new(lines: &[AliasLine]) -> Self {
        Aliases { by_key: lines.iter().map(|line| (artist_key(&line.alias), line.canonical.clone())).collect() }
    }

    /// The name the artist has today, or `name` itself when it never changed.
    pub fn canonical<'a>(&'a self, name: &'a str) -> &'a str {
        self.by_key.get(&artist_key(name)).map_or(name, String::as_str)
    }

    /// The name `name` is replaced by, none when it is not an alias.
    pub fn replacement(&self, name: &str) -> Option<&str> {
        self.by_key.get(&artist_key(name)).map(String::as_str)
    }
}

pub fn read_aliases(text: &str) -> Result<Vec<AliasLine>> {
    let mut reader = csv::ReaderBuilder::new().comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let header = reader.headers().context("reading the header of music-artists.csv")?.clone();
    let column = |name: &str| header.iter().position(|found| found == name).with_context(|| format!("music-artists.csv has no «{name}» column"));
    let (alias, canonical) = (column("alias_name")?, column("canonical_name")?);
    let mut lines = Vec::new();
    for record in reader.records() {
        let record = record.context("reading a line of music-artists.csv")?;
        let get = |at: usize| record.get(at).unwrap_or_default().trim().to_string();
        let line = AliasLine { alias: get(alias), canonical: get(canonical) };
        if !line.alias.is_empty() && !line.canonical.is_empty() {
            lines.push(line);
        }
    }
    Ok(lines)
}

/// The file's lines, none when there is no file.
pub fn load_aliases(path: &Path) -> Result<Vec<AliasLine>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_aliases(&std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_renamed_artist_is_found_by_any_spelling_of_the_old_name() {
        let aliases = Aliases::new(&read_aliases("alias_name,canonical_name\n# a note\nMarina and the Diamonds,MARINA\n").unwrap());
        assert_eq!(aliases.canonical("marina and the diamonds"), "MARINA");
        assert_eq!(aliases.canonical("Queen"), "Queen");
        assert_eq!(aliases.replacement("Queen"), None);
    }

    #[test]
    fn the_file_is_optional() {
        assert!(load_aliases(Path::new("/nonexistent/music-artists.csv")).unwrap().is_empty());
    }
}
