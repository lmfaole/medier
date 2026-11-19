//! The rest of the owner's Spotify library, kept beside the listens: saved albums, the playlists the owner made or
//! shares in (with their tracks) and the followed artists. They live at Spotify and can be removed there, so each
//! run replaces the four tables with what Spotify says now; an answer that does not add up to the total it
//! announced is refused and changes nothing. The pages are landed unchanged under `.data/raw/spotify-library/<date>/`.
//! Playlists of someone else's are listed without their tracks, and a local file or an episode has no track id and is left out.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use shared_data::batch::insert_statements;
use shared_data::job::Job;
use shared_data::sqlite_client::SqliteClient;

use crate::spotify_api::{collect_pages, Page, API};

const PAGE_SIZE: usize = 50;
const TABLES: &[&str] = &["spotify_album_saved", "spotify_playlist", "spotify_playlist_track", "spotify_followed_artist"];
const ALBUM_COLUMNS: &[&str] = &["spotify_id", "upc", "album_name", "artist_name", "release_date", "total_tracks", "label", "added_at"];
const PLAYLIST_COLUMNS: &[&str] = &["playlist_id", "playlist_name", "description", "owner_id", "is_public", "collaborative", "snapshot_id", "tracks_kept"];
const TRACK_COLUMNS: &[&str] = &["playlist_id", "position", "spotify_id", "isrc", "track_name", "artist_name", "added_at"];
const ARTIST_COLUMNS: &[&str] = &["spotify_id", "artist_name"];
const SQL_SAME_SNAPSHOT: &str = "SELECT 1 AS same FROM spotify_playlist WHERE playlist_id = ? AND snapshot_id = ?";
const SQL_STORED_TRACKS: &str = "SELECT spotify_id, isrc, track_name, artist_name, added_at FROM spotify_playlist_track WHERE playlist_id = ? ORDER BY position";
const SCOPE_HINT: &str ="run `likes-auth spotify` again if the sign-in predates the playlist and follow scopes";

#[derive(Debug, PartialEq, Eq)]
pub struct Album {
    pub spotify_id: String,
    pub upc: Option<String>,
    pub title: String,
    pub artist_name: String,
    pub release_date: Option<String>,
    pub total_tracks: Option<i64>,
    pub label: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub owner_id: String,
    pub is_public: Option<bool>,
    pub collaborative: bool,
    pub snapshot_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct PlaylistTrack {
    pub spotify_id: String,
    pub isrc: Option<String>,
    pub track_name: String,
    pub artist_name: String,
    pub added_at: Option<i64>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Artist {
    pub spotify_id: String,
    pub artist_name: String,
}

#[derive(Deserialize)]
struct Named {
    name: String,
}

#[derive(Deserialize)]
struct Envelope<T> {
    total: usize,
    items: Vec<T>,
}

#[derive(Deserialize)]
struct ExternalIds {
    isrc: Option<String>,
    upc: Option<String>,
}

#[derive(Deserialize)]
struct AlbumItem {
    added_at: String,
    album: AlbumBody,
}

#[derive(Deserialize)]
struct AlbumBody {
    id: String,
    name: String,
    #[serde(default)]
    artists: Vec<Named>,
    release_date: Option<String>,
    total_tracks: Option<i64>,
    label: Option<String>,
    external_ids: Option<ExternalIds>,
}

#[derive(Deserialize)]
struct PlaylistBody {
    id: String,
    name: String,
    description: Option<String>,
    owner: Owner,
    public: Option<bool>,
    #[serde(default)]
    collaborative: bool,
    snapshot_id: String,
}

#[derive(Deserialize)]
struct Owner {
    id: String,
}

#[derive(Deserialize)]
struct PlaylistItem {
    added_at: Option<String>,
    item: Option<TrackBody>,
}

#[derive(Deserialize)]
struct TrackBody {
    id: Option<String>,
    name: String,
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    artists: Vec<Named>,
    external_ids: Option<ExternalIds>,
}

#[derive(Deserialize)]
struct ArtistBody {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct FollowEnvelope {
    artists: FollowPage,
}

#[derive(Deserialize)]
struct FollowPage {
    items: Vec<ArtistBody>,
    total: usize,
    next: Option<String>,
}

fn page<T, U>(json: &str, what: &str, keep: impl Fn(T) -> Option<U>) -> Result<Page<U>>
where
    T: serde::de::DeserializeOwned,
{
    let envelope = serde_json::from_str::<Envelope<T>>(json).with_context(|| format!("reading a Spotify {what} page"))?;
    let count = envelope.items.len();
    Ok(Page { items: envelope.items.into_iter().filter_map(keep).collect(), total: envelope.total, count })
}

pub fn parse_albums(json: &str) -> Result<Page<Album>> {
    page(json, "saved-albums", |item: AlbumItem| {
        let added_at = chrono::DateTime::parse_from_rfc3339(&item.added_at).ok()?.timestamp();
        let album = item.album;
        Some(Album {
            spotify_id: album.id,
            upc: album.external_ids.and_then(|ids| ids.upc),
            title: album.name,
            artist_name: album.artists.into_iter().next()?.name,
            release_date: album.release_date,
            total_tracks: album.total_tracks,
            label: album.label.filter(|label| !label.is_empty()),
            added_at,
        })
    })
}

pub fn parse_playlists(json: &str) -> Result<Page<Playlist>> {
    page(json, "playlists", |list: PlaylistBody| {
        Some(Playlist {
            id: list.id,
            title: list.name,
            description: list.description.filter(|text| !text.is_empty()),
            owner_id: list.owner.id,
            is_public: list.public,
            collaborative: list.collaborative,
            snapshot_id: list.snapshot_id,
        })
    })
}

pub fn parse_playlist_tracks(json: &str) -> Result<Page<PlaylistTrack>> {
    page(json, "playlist", |entry: PlaylistItem| {
        let track = entry.item?;
        if track.kind.as_deref().is_some_and(|kind| kind != "track") {
            return None;
        }
        Some(PlaylistTrack {
            spotify_id: track.id?,
            isrc: track.external_ids.and_then(|ids| ids.isrc),
            track_name: track.name,
            artist_name: track.artists.into_iter().next()?.name,
            added_at: entry.added_at.and_then(|at| chrono::DateTime::parse_from_rfc3339(&at).ok()).map(|at| at.timestamp()),
        })
    })
}

/// A followed-artists page and the address of the next one, which this list gives as a cursor instead of an offset.
pub fn parse_followed(json: &str) -> Result<(Vec<Artist>, usize, Option<String>)> {
    let page = serde_json::from_str::<FollowEnvelope>(json).context("reading a Spotify followed-artists page")?.artists;
    let artists = page.items.into_iter().map(|artist| Artist { spotify_id: artist.id, artist_name: artist.name }).collect();
    Ok((artists, page.total, page.next))
}

/// Playlists the owner made, or one made together with others. The editorial lists a followed list can be are not the owner's.
#[must_use]
pub fn is_the_owners(list: &Playlist, owner_id: &str) -> bool {
    list.owner_id == owner_id || list.collaborative
}

fn fetch_followed(mut get: impl FnMut(&str) -> Result<String>, mut land: impl FnMut(usize, &str) -> Result<()>, first: &str) -> Result<Vec<Artist>> {
    let mut artists = Vec::new();
    let mut address = first.to_string();
    let mut number = 1;
    loop {
        let text = get(&address)?;
        land(number, &text)?;
        let (items, total, next) = parse_followed(&text)?;
        artists.extend(items);
        let Some(next) = next else {
            if artists.len() != total {
                bail!("Spotify announced {total} followed artists and gave {}", artists.len());
            }
            return Ok(artists);
        };
        address = next;
        number += 1;
    }
}

pub struct Library {
    pub albums: Vec<Album>,
    pub playlists: Vec<(Playlist, Option<Vec<PlaylistTrack>>)>,
    pub artists: Vec<Artist>,
}

/// All four tables in one batch, so a failure part way leaves the old copy.
pub fn replace_all(db: &SqliteClient, library: &Library) -> Result<()> {
    let mut batch: Vec<_> = TABLES.iter().map(|table| (format!("DELETE FROM {table}"), Vec::new())).collect();
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "spotify_album_saved",
        ALBUM_COLUMNS,
        library.albums.iter().map(|a| vec![json!(a.spotify_id), json!(a.upc), json!(a.title), json!(a.artist_name), json!(a.release_date), json!(a.total_tracks), json!(a.label), json!(a.added_at)]),
    ));
    batch.extend(insert_statements(
        "INSERT OR REPLACE INTO",
        "spotify_playlist",
        PLAYLIST_COLUMNS,
        library.playlists.iter().map(|(p, tracks)| {
            vec![json!(p.id), json!(p.title), json!(p.description), json!(p.owner_id), json!(p.is_public), json!(p.collaborative), json!(p.snapshot_id), json!(tracks.as_ref().map_or(0, Vec::len))]
        }),
    ));
    let track_rows: Vec<Vec<Value>> = library
        .playlists
        .iter()
        .flat_map(|(p, tracks)| {
            tracks.iter().flatten().enumerate().map(|(position, t)| vec![json!(p.id), json!(position), json!(t.spotify_id), json!(t.isrc), json!(t.track_name), json!(t.artist_name), json!(t.added_at)])
        })
        .collect();
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "spotify_playlist_track", TRACK_COLUMNS, track_rows));
    batch.extend(insert_statements("INSERT OR REPLACE INTO", "spotify_followed_artist", ARTIST_COLUMNS, library.artists.iter().map(|a| vec![json!(a.spotify_id), json!(a.artist_name)])));
    db.execute_batch(&batch).context("replacing the Spotify library")
}

fn optional_text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

/// The stored tracks of a playlist whose `snapshot_id` (Spotify's mark of its every version) is the one stored, or `None`
/// when it changed or was not read before.
fn stored_tracks(db: &SqliteClient, list: &Playlist) -> Result<Option<Vec<PlaylistTrack>>> {
    if db.query(SQL_SAME_SNAPSHOT, &[json!(list.id), json!(list.snapshot_id)])?.is_empty() {
        return Ok(None);
    }
    let tracks = db
        .query(SQL_STORED_TRACKS, &[json!(list.id)])?
        .iter()
        .map(|row| PlaylistTrack {
            spotify_id: row["spotify_id"].as_str().unwrap_or_default().to_string(),
            isrc: optional_text(&row["isrc"]),
            track_name: row["track_name"].as_str().unwrap_or_default().to_string(),
            artist_name: row["artist_name"].as_str().unwrap_or_default().to_string(),
            added_at: row["added_at"].as_i64(),
        })
        .collect();
    Ok(Some(tracks))
}

/// The `spotify-library` job: saved albums, own playlists with tracks, followed artists. A playlist whose version is
/// the stored one has its tracks taken from the table, not asked again.
pub fn sync(db: &SqliteClient) -> Result<()> {
    let http = crate::spotify_api::client()?;
    let token = crate::spotify_api::access_token(&http)?;
    let get = |url: &str| crate::spotify_api::send(&http, &token, &reqwest::Method::GET, url);
    let directory = crate::lastfm::fresh_landing("spotify-library", chrono::Utc::now().date_naive())?;
    let land_as = |name: String| {
        let directory = directory.clone();
        move |number: usize, text: &str| {
            let path = directory.join(format!("{name}-{number:05}.json"));
            std::fs::write(&path, text).with_context(|| format!("writing {}", path.display()))
        }
    };

    let owner_id = serde_json::from_str::<Value>(&get(&format!("{API}/me"))?).context("reading Spotify's profile")?["id"].as_str().context("Spotify's profile has no id")?.to_string();
    // Saved albums do not come strictly newest first, so a first page cannot vouch for the rest; there are few pages.
    let albums = collect_pages(PAGE_SIZE, "saved albums", |offset| get(&format!("{API}/me/albums?limit={PAGE_SIZE}&offset={offset}")), land_as("albums".into()), parse_albums)?;
    let lists = collect_pages(PAGE_SIZE, "playlists", |offset| get(&format!("{API}/me/playlists?limit={PAGE_SIZE}&offset={offset}")), land_as("playlists".into()), parse_playlists)
        .context(SCOPE_HINT)?;
    let mut playlists = Vec::new();
    let (mut asked, mut kept) = (0, 0);
    for list in lists {
        let tracks = if !is_the_owners(&list, &owner_id) {
            None
        } else if let Some(stored) = stored_tracks(db, &list)? {
            kept += 1;
            Some(stored)
        } else {
            asked += 1;
            let url = |offset: usize| format!("{API}/playlists/{}/items?limit=100&offset={offset}", list.id);
            Some(collect_pages(100, "playlist tracks", |offset| get(&url(offset)), land_as(format!("playlist-{}", list.id)), parse_playlist_tracks)?)
        };
        playlists.push((list, tracks));
    }
    println!("spotify-library: {asked} playlists read again, {kept} unchanged since the last run");
    let artists = fetch_followed(&get, land_as("follows".into()), &format!("{API}/me/following?type=artist&limit={PAGE_SIZE}")).context(SCOPE_HINT)?;

    let library = Library { albums, playlists, artists };
    replace_all(db, &library)?;
    let kept: usize = library.playlists.iter().map(|(_, tracks)| tracks.as_ref().map_or(0, Vec::len)).sum();
    println!("{} saved albums, {} playlists ({kept} tracks), {} followed artists", library.albums.len(), library.playlists.len(), library.artists.len());
    Ok(())
}

#[must_use]
pub fn jobs() -> Vec<Job<SqliteClient>> {
    vec![Job::new("spotify-library", "replace the saved albums, playlists and followed artists with what Spotify says now", |db, _| sync(db))]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(owner: &str, collaborative: bool) -> Playlist {
        Playlist { id: "p".into(), title: "n".into(), description: None, owner_id: owner.into(), is_public: None, collaborative, snapshot_id: "s".into() }
    }

    #[test]
    fn a_playlist_page_keeps_tracks_and_drops_episodes_local_files_and_removed_entries() {
        let json = json!({"total": 4, "items": [
            {"added_at": "2024-03-01T12:00:00Z", "item": {"id": "t1", "name": "Song", "type": "track", "artists": [{"name": "A"}, {"name": "B"}], "external_ids": {"isrc": "USX"}}},
            {"added_at": "2024-03-01T12:00:00Z", "item": {"id": "e1", "name": "Episode", "type": "episode"}},
            {"added_at": "2024-03-01T12:00:00Z", "item": {"id": null, "name": "Local", "type": "track", "artists": [{"name": "A"}]}},
            {"added_at": null, "item": null}
        ]})
        .to_string();
        let parsed = parse_playlist_tracks(&json).unwrap();
        assert_eq!(parsed.count, 4);
        assert_eq!(parsed.items.len(), 1);
        assert_eq!((parsed.items[0].artist_name.as_str(), parsed.items[0].isrc.as_deref(), parsed.items[0].added_at), ("A", Some("USX"), Some(1_709_294_400)));
    }

    #[test]
    fn an_album_keeps_the_first_artist_and_its_upc() {
        let json = json!({"total": 1, "items": [{"added_at": "2024-03-01T12:00:00Z", "album": {"id": "a1", "name": "Rec", "artists": [{"name": "X"}, {"name": "Y"}], "release_date": "2024-01-01", "total_tracks": 12, "label": "", "external_ids": {"upc": "0088"}}}]}).to_string();
        let parsed = parse_albums(&json).unwrap();
        assert_eq!((parsed.items[0].artist_name.as_str(), parsed.items[0].upc.as_deref(), parsed.items[0].label.clone()), ("X", Some("0088"), None));
    }

    #[test]
    fn only_the_owners_own_and_shared_lists_have_their_tracks_read() {
        assert!(is_the_owners(&list("me", false), "me"));
        assert!(is_the_owners(&list("friend", true), "me"));
        assert!(!is_the_owners(&list("spotify", false), "me"));
    }

    #[test]
    fn followed_artists_follow_the_cursor_and_a_short_answer_is_refused() {
        let first = json!({"artists": {"total": 2, "next": "next-url", "items": [{"id": "a1", "name": "One"}]}}).to_string();
        let second = json!({"artists": {"total": 2, "next": null, "items": [{"id": "a2", "name": "Two"}]}}).to_string();
        let mut asked = Vec::new();
        let artists = fetch_followed(
            |url| {
                asked.push(url.to_string());
                Ok(if url == "first-url" { first.clone() } else { second.clone() })
            },
            |_, _| Ok(()),
            "first-url",
        )
        .unwrap();
        assert_eq!((artists.len(), asked), (2, vec!["first-url".to_string(), "next-url".to_string()]));
        let short = json!({"artists": {"total": 3, "next": null, "items": [{"id": "a1", "name": "One"}]}}).to_string();
        assert!(fetch_followed(|_| Ok(short.clone()), |_, _| Ok(()), "u").is_err());
    }
}
