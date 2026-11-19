//! A picture of each artist from Spotify, which is looked at first: the artist is asked for by name and the answer is kept
//! only when Spotify's artist is named exactly the same, since a name alone matches the wrong band now and then. Each answer
//! is landed unchanged under `.data/raw/spotify-images/<date>/`. Deezer and Wikimedia Commons stay the picture of an artist
//! Spotify has none of (`entity_artists.rs`).

use anyhow::Result;
use serde_json::{json, Value};
use shared_data::job::Job;
use shared_data::shelf::{landing, now};
use shared_data::sqlite_client::SqliteClient;
use shared_data::tmdb::land;

use crate::deezer::same_name;
use crate::spotify_api::{access_token, client, picture_address, limit_of, search, SEARCH_PAUSE};

// The most played first. A credit names every artist of a recording, so the shortest of an artist's names is the one that is them alone.
const SQL_ARTISTS: &str = "SELECT recording_metadata.artist_mbid AS id, listens.artist_name AS name, MIN(LENGTH(listens.artist_name)) FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.artist_mbid IS NOT NULL AND listens.artist_name IS NOT NULL \
      AND recording_metadata.artist_mbid NOT IN (SELECT artist_mbid FROM artist_spotify) \
    GROUP BY id ORDER BY COUNT(*) DESC, id LIMIT ?";
const SQL_STORE: &str = "INSERT OR REPLACE INTO artist_spotify (artist_mbid, spotify_id, image, fetched_at) VALUES (?, ?, ?, ?)";

/// The first artist of Spotify's answer named exactly `name` that has a picture: Spotify's id and the address of the picture to keep.
#[must_use]
pub fn picture_of(answer: &Value, name: &str) -> Option<(String, String)> {
    answer["artists"]["items"].as_array()?.iter().find_map(|artist| {
        if same_name(artist["name"].as_str()?) != same_name(name) {
            return None;
        }
        Some((artist["id"].as_str()?.to_string(), picture_address(&artist["images"])?))
    })
}

/// Asks Spotify about at most `limit` artists that have not been asked.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let http = client()?;
    let token = access_token(&http)?;
    let directory = landing("spotify-images")?;
    let (mut asked, mut found) = (0, 0);
    for row in db.query(SQL_ARTISTS, &[json!(limit)])? {
        let Some(id) = row["id"].as_str() else { continue };
        let Some(name) = row["name"].as_str() else { continue };
        std::thread::sleep(SEARCH_PAUSE);
        // A failed call leaves the artist unasked, so the next run tries again.
        let answer: Value = match search(&http, &token, name, "artist") {
            Ok(answer) => answer,
            Err(error) => {
                eprintln!("spotify-images: {name} was not answered: {error:#}");
                continue;
            }
        };
        land(&directory.join(format!("artist-{id}.json")), &answer)?;
        let picture = picture_of(&answer, name);
        db.execute(SQL_STORE, &[json!(id), json!(picture.as_ref().map(|p| &p.0)), json!(picture.as_ref().map(|p| &p.1)), json!(now())])?;
        asked += 1;
        found += usize::from(picture.is_some());
    }
    println!("spotify-images: asked for {asked} artists, {found} have a picture");
    Ok(())
}

pub fn job() -> Job<SqliteClient> {
    Job::new("spotify-images", "ask Spotify for the picture of each artist not yet asked, at most <limit> artists", |db, args| run(db, limit_of(args)?)).takes(&["limit"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_picture_is_kept_for_the_artist_of_the_same_name_that_has_one() {
        let answer = json!({"artists": {"items": [
            {"id": "x", "name": "Tinashe Fan Club", "images": [{"url": "https://i.scdn.co/image/aaa", "width": 640}]},
            {"id": "y", "name": "TINASHE", "images": []},
            {"id": "z", "name": "Tinashe", "images": [{"url": "https://i.scdn.co/image/small", "width": 160}, {"url": "https://i.scdn.co/image/big", "width": 300}]},
        ]}});
        assert_eq!(picture_of(&answer, "Tinashe"), Some(("z".to_string(), "https://i.scdn.co/image/big".to_string())));
        assert_eq!(picture_of(&answer, "Beyoncé"), None);
    }
}
