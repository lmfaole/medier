//! A cover for each album from Spotify, which is looked at first: the album is asked for by its name and artist, and the answer
//! is kept only when Spotify's album is named exactly the same and one of its artists is the one heard. The cover is kept for every
//! Cover Art Archive release the album's listens name (`album_spotify`), because that release is what a page's cover path is made
//! of; `scripts/fetch-covers.ts` lands Spotify's picture under that path instead of the archive's. Each answer is landed unchanged
//! under `.data/raw/spotify-album-images/<date>/`.

use anyhow::Result;
use serde_json::{json, Value};
use shared_data::{
    job::Job,
    shelf::{landing, now},
    sqlite_client::SqliteClient,
    tmdb::land,
};

use crate::deezer::same_name;
use crate::spotify_api::{access_token, client, picture_address, limit_of, search, SEARCH_PAUSE};

// The most played first. An album with a release not yet asked about is asked again, and every release of it is stored.
const SQL_ALBUMS: &str = "SELECT listens.artist_name AS artist, listens.release_name AS album, GROUP_CONCAT(DISTINCT recording_metadata.caa_release_mbid) AS releases \
    FROM listens JOIN recording_metadata USING (recording_mbid) \
    WHERE recording_metadata.caa_release_mbid IS NOT NULL AND recording_metadata.caa_id IS NOT NULL \
      AND listens.artist_name IS NOT NULL AND listens.release_name IS NOT NULL AND listens.release_name != '' \
      AND recording_metadata.caa_release_mbid NOT IN (SELECT release_mbid FROM album_spotify) \
    GROUP BY listens.artist_name, listens.release_name ORDER BY COUNT(*) DESC, artist, album LIMIT ?";
const SQL_STORE: &str = "INSERT OR REPLACE INTO album_spotify (release_mbid, spotify_id, image, fetched_at) VALUES (?, ?, ?, ?)";

/// The first album of Spotify's answer named exactly `album` by an artist the credit `artist` names (a collaboration is written as one string), with a picture: Spotify's id and the address.
#[must_use]
pub fn cover_of(answer: &Value, album: &str, artist: &str) -> Option<(String, String)> {
    let credit = same_name(artist);
    answer["albums"]["items"].as_array()?.iter().find_map(|item| {
        if same_name(item["name"].as_str()?) != same_name(album) {
            return None;
        }
        let by_the_artist = item["artists"].as_array()?.iter().filter_map(|a| a["name"].as_str()).map(same_name).any(|name| !name.is_empty() && credit.contains(&name));
        by_the_artist.then(|| Some((item["id"].as_str()?.to_string(), picture_address(&item["images"])?))).flatten()
    })
}

/// Asks Spotify about at most `limit` albums that have a release not yet asked about.
pub fn run(db: &SqliteClient, limit: usize) -> Result<()> {
    let http = client()?;
    let token = access_token(&http)?;
    let directory = landing("spotify-album-images")?;
    let (mut asked, mut found) = (0, 0);
    for row in db.query(SQL_ALBUMS, &[json!(limit)])? {
        let (Some(artist), Some(album), Some(releases)) = (row["artist"].as_str(), row["album"].as_str(), row["releases"].as_str()) else { continue };
        std::thread::sleep(SEARCH_PAUSE);
        // A failed call leaves the album unasked, so the next run tries again.
        let answer = match search(&http, &token, &format!("album:{album} artist:{artist}"), "album") {
            Ok(answer) => answer,
            Err(error) => {
                eprintln!("spotify-album-images: {album} by {artist} was not answered: {error:#}");
                continue;
            }
        };
        land(&directory.join(format!("album-{}.json", releases.split(',').next().unwrap_or_default())), &json!({"artist": artist, "album": album, "answer": answer}))?;
        let cover = cover_of(&answer, album, artist);
        for release in releases.split(',') {
            db.execute(SQL_STORE, &[json!(release), json!(cover.as_ref().map(|c| &c.0)), json!(cover.as_ref().map(|c| &c.1)), json!(now())])?;
        }
        asked += 1;
        found += usize::from(cover.is_some());
    }
    println!("spotify-album-images: asked for {asked} albums, {found} have a cover");
    Ok(())
}

pub fn job() -> Job<SqliteClient> {
    Job::new("spotify-album-images", "ask Spotify for the cover of each album not yet asked, at most <limit> albums", |db, args| run(db, limit_of(args)?)).takes(&["limit"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cover_is_kept_only_for_the_album_of_the_same_name_by_the_artist_heard() {
        let answer = json!({"albums": {"items": [
            {"id": "a", "name": "Lemonade (Karaoke)", "artists": [{"name": "Beyoncé"}], "images": [{"url": "https://i.scdn.co/image/k", "width": 300}]},
            {"id": "b", "name": "Lemonade", "artists": [{"name": "Tribute Band"}], "images": [{"url": "https://i.scdn.co/image/t", "width": 300}]},
            {"id": "c", "name": "LEMONADE", "artists": [{"name": "Beyoncé"}], "images": [{"url": "https://i.scdn.co/image/s", "width": 64}, {"url": "https://i.scdn.co/image/m", "width": 300}, {"url": "https://i.scdn.co/image/l", "width": 640}]},
        ]}});
        assert_eq!(cover_of(&answer, "Lemonade", "Beyoncé & Jay-Z"), Some(("c".to_string(), "https://i.scdn.co/image/m".to_string())));
        assert_eq!(cover_of(&answer, "Lemonade", "Someone Else"), None);
    }
}
