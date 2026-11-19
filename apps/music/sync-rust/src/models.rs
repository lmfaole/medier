//! Shapes for the ListenBrainz API response and the rows this crate writes
//! to the database. Kept separate from the API clients so a change to
//! either API cannot silently change what a "listen" means here.

use serde::Deserialize;

/// One play, after dropping the ListenBrainz envelope we do not use.
#[derive(Debug, Clone)]
pub struct Listen {
    pub listened_at: i64,
    pub track_name: String,
    pub artist_name: String,
    pub release_name: Option<String>,
    pub recording_mbid: Option<String>,
    pub artist_mbid: Option<String>,
    pub release_mbid: Option<String>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ListenBrainzEnvelope {
    pub payload: ListenBrainzPayload,
}

#[derive(Debug, Deserialize)]
pub struct ListenBrainzPayload {
    pub listens: Vec<ListenBrainzListen>,
    /// The user's first listen, whatever page was asked for.
    #[serde(default)]
    pub oldest_listen_ts: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ListenBrainzListen {
    pub listened_at: i64,
    pub track_metadata: ListenBrainzTrackMetadata,
}

#[derive(Debug, Deserialize)]
pub struct ListenBrainzTrackMetadata {
    pub artist_name: String,
    pub track_name: String,
    pub release_name: Option<String>,
    #[serde(default)]
    pub additional_info: Option<ListenBrainzAdditionalInfo>,
    #[serde(default)]
    pub mbid_mapping: Option<ListenBrainzMbidMapping>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListenBrainzAdditionalInfo {
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListenBrainzMbidMapping {
    pub recording_mbid: Option<String>,
    #[serde(default)]
    pub artist_mbids: Vec<String>,
    pub release_mbid: Option<String>,
}

impl From<ListenBrainzListen> for Listen {
    fn from(entry: ListenBrainzListen) -> Self {
        let metadata = entry.track_metadata;
        let mapping = metadata.mbid_mapping.unwrap_or_default();
        Listen {
            listened_at: entry.listened_at,
            track_name: metadata.track_name,
            artist_name: metadata.artist_name,
            release_name: metadata.release_name,
            recording_mbid: mapping.recording_mbid,
            artist_mbid: mapping.artist_mbids.into_iter().next(),
            release_mbid: mapping.release_mbid,
            duration_ms: metadata.additional_info.and_then(|info| info.duration_ms),
        }
    }
}

/// One recording's entry in a `/1/metadata/recording` response, which is a
/// JSON object keyed by recording MBID. A recording ListenBrainz does not
/// know is simply absent from that object. Every field is optional because
/// MusicBrainz data is community-entered and routinely incomplete.
#[derive(Debug, Deserialize, Default)]
pub struct RecordingMetadataResponse {
    #[serde(default)]
    pub artist: Option<MetadataArtistCredit>,
    #[serde(default)]
    pub recording: Option<MetadataRecording>,
    #[serde(default)]
    pub release: Option<MetadataRelease>,
    #[serde(default)]
    pub tag: Option<MetadataTags>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetadataArtistCredit {
    #[serde(default)]
    pub artists: Vec<MetadataArtist>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetadataArtist {
    pub artist_mbid: Option<String>,
    pub area: Option<String>,
    #[serde(rename = "type")]
    pub artist_type: Option<String>,
    pub begin_year: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetadataRecording {
    pub first_release_date: Option<String>,
    pub length: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetadataRelease {
    pub year: Option<i64>,
    pub release_group_mbid: Option<String>,
    pub caa_release_mbid: Option<String>,
    pub caa_id: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct MetadataTags {
    #[serde(default)]
    pub recording: Vec<MetadataTag>,
    #[serde(default)]
    pub release_group: Vec<MetadataTag>,
    #[serde(default)]
    pub artist: Vec<MetadataTag>,
}

/// A folksonomy tag. Only tags carrying a `genre_mbid` are MusicBrainz
/// genres; the rest are free text such as "norwegian" or "seen live".
#[derive(Debug, Deserialize)]
pub struct MetadataTag {
    pub tag: String,
    pub count: i64,
    pub genre_mbid: Option<String>,
}

/// What `recording_metadata` and `recording_genres` store for one recording.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct RecordingMetadata {
    pub recording_mbid: String,
    pub release_year: Option<i64>,
    pub release_date: Option<String>,
    pub length_ms: Option<i64>,
    pub artist_mbid: Option<String>,
    pub artist_area: Option<String>,
    pub artist_type: Option<String>,
    pub artist_begin_year: Option<i64>,
    pub release_group_mbid: Option<String>,
    pub caa_release_mbid: Option<String>,
    pub caa_id: Option<i64>,
    pub genres: Vec<String>,
}
