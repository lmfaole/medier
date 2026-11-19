//! A picture of each artist from Deezer, which has the press photos a page can show: the artist is asked for by name and the
//! answer is kept only when Deezer's artist is named exactly the same, since a name alone matches the wrong band now and then.
//! Each answer is landed unchanged under `.data/raw/deezer/<date>/` before it is read. Wikimedia Commons stays the picture of an
//! artist Deezer has none of (`entity_artists.rs`).

use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

const SEARCH: &str = "https://api.deezer.com/search/artist";
/// Deezer allows fifty requests in five seconds.
const PAUSE: Duration = Duration::from_millis(250);

// The most played first. A credit names every artist of a recording, so the shortest of an artist's names is the one that is them alone.
const SQL_ARTISTS: &str = "SELECT recording_metadata.artist_mbid AS id, listens.artist_name AS name, MIN(LENGTH(listens.artist_name)) FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.artist_mbid IS NOT NULL AND listens.artist_name IS NOT NULL \
      AND recording_metadata.artist_mbid NOT IN (SELECT artist_mbid FROM artist_deezer) \
    GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?";

/// Letters and digits only, in lower case, so «Beyoncé» and «BEYONCÉ.» are the same name.
pub fn same_name(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The first artist of Deezer's answer named exactly `name` that has a picture of their own: Deezer's id and the 1000 px address.
/// An artist without one is served a picture whose address has no hash in it.
#[must_use]
pub fn picture_of(answer: &Value, name: &str) -> Option<(i64, String)> {
    answer["data"].as_array()?.iter().find_map(|artist| {
        let picture = artist["picture_xl"].as_str().filter(|address| address.starts_with("https://") && !address.contains("/artist//"))?;
        (same_name(artist["name"].as_str()?) == same_name(name)).then(|| (artist["id"].as_i64()).map(|id| (id, picture.to_string()))).flatten()
    })
}

/// Asks Deezer about at most `limit` artists that have not been asked.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let client = crate::listenbrainz::http_client()?;
    let directory = landing("deezer")?;
    let (mut asked, mut found) = (0, 0);
    for row in db.query(SQL_ARTISTS, &[json!(limit)])? {
        let (Some(id), Some(name)) = (row["id"].as_str(), row["name"].as_str()) else { continue };
        std::thread::sleep(PAUSE);
        // A timeout leaves the artist unasked, so the next run tries again.
        let answer: Value = match client.get(SEARCH).query(&[("q", name), ("limit", "5")]).send().and_then(reqwest::blocking::Response::error_for_status).and_then(reqwest::blocking::Response::json) {
            Ok(answer) => answer,
            Err(error) => {
                eprintln!("deezer: {name} was not answered: {error}");
                continue;
            }
        };
        land(&directory.join(format!("artist-{id}.json")), &answer)?;
        let picture = picture_of(&answer, name);
        db.execute("INSERT OR REPLACE INTO artist_deezer (artist_mbid, deezer_id, image, fetched_at) VALUES (?, ?, ?, ?)", &[json!(id), json!(picture.as_ref().map(|p| p.0)), json!(picture.as_ref().map(|p| &p.1)), json!(now())])?;
        asked += 1;
        found += usize::from(picture.is_some());
    }
    println!("deezer: asked for {asked} artists, {found} have a picture");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_is_kept_only_for_the_artist_of_the_same_name_that_has_one() {
        let answer = json!({"data": [
            {"id": 1, "name": "Tinashe Fan Club", "picture_xl": "https://cdn-images.dzcdn.net/images/artist/aaa/1000x1000-000000-80-0-0.jpg"},
            {"id": 2, "name": "TINASHE", "picture_xl": "https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg"},
            {"id": 3, "name": "Tinashe", "picture_xl": "https://cdn-images.dzcdn.net/images/artist/bbb/1000x1000-000000-80-0-0.jpg"},
        ]});
        assert_eq!(picture_of(&answer, "Tinashe"), Some((3, "https://cdn-images.dzcdn.net/images/artist/bbb/1000x1000-000000-80-0-0.jpg".to_string())));
        assert_eq!(picture_of(&answer, "Beyoncé"), None);
        assert_eq!(same_name("Beyoncé."), same_name("BEYONCÉ"));
    }
}
