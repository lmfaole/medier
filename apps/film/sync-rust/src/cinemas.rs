//! The cinemas a film was seen in, written by hand in `.data/film-cinemas.csv` (`name,owner,country,city,website,image`, a line
//! starting with `#` a comment) because no register has them as the owner knows them. `name` is what the film log's
//! `cinema` column says, so a viewing is joined to its cinema by it; `country` is the two-letter ISO 3166-1 code.
//! `import` makes `film_cinema` exactly the file's rows.

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::json;
use shared_data::batch::insert_statements;
use shared_data::sqlite_client::SqliteClient;

#[derive(Debug, Clone, PartialEq)]
pub struct Cinema {
    pub name: String,
    pub owner: Option<String>,
    pub country: String,
    pub city: Option<String>,
    /// The cinema's own address, `http` or `https`.
    pub website: Option<String>,
    /// A photo of the cinema on its own site, `http` or `https`: the address the film app lands it from.
    pub image: Option<String>,
}

fn blank(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

/// Every cinema in the file's text; the first line may be the header. An error names the line.
pub fn parse_cinemas(text: &str) -> Result<Vec<Cinema>> {
    let mut reader = csv::ReaderBuilder::new().has_headers(false).comment(Some(b'#')).flexible(true).from_reader(text.as_bytes());
    let mut cinemas: Vec<Cinema> = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.with_context(|| format!("reading record {}", index + 1))?;
        let field = |position: usize| record.get(position).unwrap_or_default();
        if index == 0 && field(0).trim() == "name" {
            continue;
        }
        let line = record.position().map_or(index + 1, |position| usize::try_from(position.line()).unwrap_or(index + 1));
        let Some(name) = blank(field(0)) else { bail!("line {line} of the cinema file: the name is empty") };
        let country = field(2).trim().to_uppercase();
        if country.len() != 2 || !country.chars().all(|letter| letter.is_ascii_uppercase()) {
            bail!("line {line} of the cinema file: «{country}» is not a two-letter country code");
        }
        if cinemas.iter().any(|cinema| cinema.name == name) {
            bail!("line {line} of the cinema file: «{name}» is there twice");
        }
        let website = blank(field(4));
        if website.as_deref().is_some_and(|address| !address.starts_with("https://") && !address.starts_with("http://")) {
            bail!("line {line} of the cinema file: the website must start with https:// or http://");
        }
        let image = blank(field(5));
        if image.as_deref().is_some_and(|address| !address.starts_with("https://") && !address.starts_with("http://")) {
            bail!("line {line} of the cinema file: the image must start with https:// or http://");
        }
        cinemas.push(Cinema { name, owner: blank(field(1)), country, city: blank(field(3)), website, image });
    }
    Ok(cinemas)
}

/// Makes `film_cinema` the file's rows and nothing else.
pub fn import(db: &SqliteClient, path: &Path) -> Result<usize> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}: write the cinemas there (name,owner,country,city)", path.display()))?;
    let cinemas = parse_cinemas(&text)?;
    let mut batch = vec![("DELETE FROM film_cinema".to_string(), Vec::new())];
    batch.extend(insert_statements(
        "INSERT INTO",
        "film_cinema",
        &["name", "owner", "country", "city", "website", "image"],
        cinemas.iter().map(|cinema| vec![json!(cinema.name), json!(cinema.owner), json!(cinema.country), json!(cinema.city), json!(cinema.website), json!(cinema.image)]),
    ));
    db.execute_batch(&batch).context("replacing the cinemas with the file's")?;
    Ok(cinemas.len())
}

/// The cinemas the viewings name that the file does not have, so a viewing is never counted under a cinema nobody described.
#[must_use]
pub fn unknown(db: &SqliteClient) -> Vec<String> {
    db.query("SELECT DISTINCT cinema FROM film_watch WHERE cinema IS NOT NULL AND cinema NOT IN (SELECT name FROM film_cinema) ORDER BY cinema", &[])
        .unwrap_or_default()
        .iter()
        .filter_map(|row| row["cinema"].as_str().map(str::to_string))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "# cinemas\nname,owner,country,city,website\nCinemateket,Norsk filminstitutt,no,Oslo,https://www.cinemateket.no/\n\"Vika, kino\",,NO,\n";

    #[test]
    fn a_cinema_has_its_owner_and_city_empty_or_set_and_the_country_in_capitals() {
        let cinemas = parse_cinemas(FILE).unwrap_or_else(|error| panic!("{error:#}"));
        assert_eq!(cinemas.len(), 2);
        assert_eq!((cinemas[0].owner.as_deref(), cinemas[0].country.as_str(), cinemas[0].city.as_deref()), (Some("Norsk filminstitutt"), "NO", Some("Oslo")));
        assert_eq!((cinemas[1].name.as_str(), cinemas[1].owner.as_deref(), cinemas[1].city.as_deref()), ("Vika, kino", None, None));
        assert_eq!((cinemas[0].website.as_deref(), cinemas[1].website.as_deref()), (Some("https://www.cinemateket.no/"), None));
    }

    #[test]
    fn a_wrong_line_is_refused_with_its_line_number() {
        for (line, wrong) in [(",x,NO,Oslo", "name is empty"), ("A,x,Norway,Oslo", "country code"), ("A,x,N,Oslo", "country code"), ("A,x,NO,Oslo,www.a.no", "https://"), ("A,x,NO,Oslo,https://a.no,a.jpg", "image must start")] {
            let error = format!("{:#}", parse_cinemas(&format!("name,owner,country,city,website\n{line}\n")).err().unwrap_or_else(|| panic!("{line} was accepted")));
            assert!(error.contains("line 2") && error.contains(wrong), "{line}: {error}");
        }
        assert!(format!("{:#}", parse_cinemas("name,owner,country,city\nA,,NO,\nA,,NO,\n").err().unwrap_or_else(|| panic!("a twin was accepted"))).contains("twice"));
    }

    #[test]
    fn importing_twice_leaves_the_file_and_a_cinema_the_viewings_name_but_the_file_lacks_is_unknown() {
        let db = shared_data::app_db::memory_with_schema(crate::schema::SCHEMA);
        let dir = std::env::temp_dir().join(format!("film-cinemas-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap_or_else(|error| panic!("{error}"));
        let path = dir.join("cinemas.csv");
        std::fs::write(&path, FILE).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 2);
        assert_eq!(import(&db, &path).unwrap_or_else(|error| panic!("{error:#}")), 2);
        db.execute("INSERT INTO film_watch (watched_on, title, rewatch, cinema) VALUES ('2026-01-01', 'A', 0, 'Cinemateket'), ('2026-01-02', 'B', 0, 'Elsewhere'), ('2026-01-03', 'C', 0, NULL)", &[]).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(unknown(&db), vec!["Elsewhere".to_string()]);
    }
}
