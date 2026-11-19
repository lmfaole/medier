//! The colour of each album cover: `.data/music-cover-colors.csv` (`MUSIC_COVER_COLORS` names another file), written by
//! `npm run cover:colors`, which reads the pictures. `import-cover-colors` makes `music_cover_color` exactly its lines.

use anyhow::{ensure, Context, Result};
use serde_json::json;
use shared_data::app_db::path_from_env;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

/// The jobs of the cover colours, which `main` adds to its own.
#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new("import-cover-colors", "make the cover colours exactly the lines of music-cover-colors.csv", |db, _| import(db))]
}

/// The covers and colours in the file's text (`cover,color`), the header skipped: a colour is `#rrggbb`.
pub fn read(text: &str) -> Result<Vec<(String, String)>> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).from_reader(text.as_bytes());
    let mut colours = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.with_context(|| format!("reading record {} of the cover colours", index + 1))?;
        if index == 0 && record.get(0).is_some_and(|first| first.trim() == "cover") {
            continue;
        }
        let (cover, colour) = (record.get(0).unwrap_or_default().trim(), record.get(1).unwrap_or_default().trim());
        ensure!(!cover.is_empty() && colour.len() == 7 && colour.starts_with('#') && colour[1..].chars().all(|c| c.is_ascii_hexdigit()), "line {} of the cover colours is not a cover and a colour written #rrggbb", index + 1);
        colours.push((cover.to_string(), colour.to_lowercase()));
    }
    Ok(colours)
}

fn import(db: &SqliteClient) -> Result<()> {
    let path = path_from_env("MUSIC_COVER_COLORS", "../../.data/music-cover-colors.csv");
    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}: `npm run cover:colors` writes it", path.display()))?;
    let colours = read(&text)?;
    let rows = colours.iter().map(|(cover, colour)| vec![json!(cover), json!(colour)]).collect();
    shared_data::log_file::replace(db, "music_cover_color", &["cover", "color"], rows, "cover colours")?;
    println!("import-cover-colors: {} colours", colours.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_a_cover_and_a_colour() {
        assert_eq!(read("cover,color\nabc/1,#7AB0CB\n").unwrap_or_else(|error| panic!("{error:#}")), vec![("abc/1".to_string(), "#7ab0cb".to_string())]);
        assert!(read("cover,color\nabc/1,blue\n").is_err());
    }
}
