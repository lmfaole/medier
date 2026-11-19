//! Client for the public ListenBrainz API: a user's listens and the
//! MusicBrainz metadata for the recordings in them. Neither needs
//! authentication.
//!
//! Reference: the "listens" and "metadata" sections of
//! <https://listenbrainz.org/api-docs/>.

use crate::models::{Listen, ListenBrainzEnvelope, RecordingMetadataResponse};
use anyhow::{anyhow, bail, Context, Result};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::thread;
use std::time::Duration;

const MAX_COUNT_PER_PAGE: u32 = 1000;
const MAX_ATTEMPTS_PER_REQUEST: u32 = 5;

/// MBIDs per metadata request. The MBIDs travel in the query string, and
/// ListenBrainz answers 502 somewhere past 100 of them.
pub const MAX_RECORDINGS_PER_METADATA_REQUEST: usize = 50;

/// ListenBrainz can be slow to assemble large pages; a generous read
/// timeout plus retries avoids one slow request aborting the whole sync.
pub fn http_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("music-sync/0.1 (+https://sky.lmfaole.party/apps/medier/musikk)")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .context("building HTTP client")
}

/// Fetches every listen newer than `min_ts` (exclusive), oldest page first,
/// and hands each page to `on_page` with the bookmark to store once it is
/// written.
///
/// With `min_ts`, ListenBrainz returns the `count` listens right after it,
/// so walking forwards means a page is only ever followed by newer ones: once
/// a page is in the database, nothing older than its bookmark is still missing. A run
/// that times out partway (a full-history backfill is dozens of slow pages)
/// therefore resumes from the last page it wrote instead of starting over.
pub fn fetch_new_listens(
    username: &str,
    min_ts: i64,
    mut on_page: impl FnMut(&[Listen], i64) -> Result<()>,
) -> Result<()> {
    let client = http_client()?;
    let mut cursor = min_ts;

    loop {
        let url = format!(
            "https://api.listenbrainz.org/1/user/{username}/listens?count={MAX_COUNT_PER_PAGE}&min_ts={cursor}"
        );
        let envelope: ListenBrainzEnvelope = get_json_with_retries(&client, &url)?;
        let page_was_full = u32::try_from(envelope.payload.listens.len()).is_ok_and(|len| len >= MAX_COUNT_PER_PAGE);
        let envelope_oldest = envelope.payload.oldest_listen_ts;

        let listens: Vec<Listen> = envelope
            .payload
            .listens
            .into_iter()
            .filter(|listen| listen.listened_at > cursor)
            .map(Listen::from)
            .collect();
        let Some(newest_on_page) = listens.iter().map(|listen| listen.listened_at).max() else {
            // ListenBrainz only searches a window after `min_ts`, so a cursor
            // long before the user's first listen (a backfill from 0) finds
            // nothing; the payload says where the history starts.
            if let Some(start) = jump_to_history_start(cursor, envelope_oldest) {
                cursor = start;
                continue;
            }
            break;
        };

        let next = next_cursor(cursor, newest_on_page, page_was_full);
        on_page(&listens, next)?;
        if !page_was_full {
            break;
        }
        cursor = next;
    }

    Ok(())
}

/// The cursor to retry from when a page came back empty: just before the
/// user's first listen, if the cursor is still earlier than that.
pub fn jump_to_history_start(cursor: i64, oldest_listen_ts: Option<i64>) -> Option<i64> {
    let start = oldest_listen_ts? - 1;
    (start > cursor).then_some(start)
}

/// The `min_ts` for the page after one whose newest listen is
/// `newest_on_page`. A full page may have stopped part-way through a second
/// that holds several listens, so the next request re-reads that second
/// (`INSERT OR IGNORE` drops the repeats); it still always moves forward.
/// A page that was not full reached the present, so the bookmark is exact.
pub fn next_cursor(cursor: i64, newest_on_page: i64, page_was_full: bool) -> i64 {
    let next = if page_was_full { newest_on_page - 1 } else { newest_on_page };
    if next > cursor {
        next
    } else {
        cursor.max(newest_on_page)
    }
}

/// Metadata for up to `MAX_RECORDINGS_PER_METADATA_REQUEST` recordings,
/// keyed by recording MBID. Recordings ListenBrainz does not know are
/// missing from the map rather than an error.
pub fn fetch_recording_metadata(
    client: &reqwest::blocking::Client,
    recording_mbids: &[String],
) -> Result<HashMap<String, RecordingMetadataResponse>> {
    let url = format!(
        "https://api.listenbrainz.org/1/metadata/recording/?recording_mbids={}&inc=artist%20tag%20release",
        recording_mbids.join(",")
    );
    get_json_with_retries(client, &url)
}

/// GETs `url` as JSON, retrying with exponential backoff, since the public
/// ListenBrainz API has no documented SLA and occasionally times out under
/// a full-history backfill. A 429 waits out `X-RateLimit-Reset-In` instead,
/// and a response that used up the rate-limit window waits before
/// returning, so the next call does not start with a guaranteed 429.
fn get_json_with_retries<T: DeserializeOwned>(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<T> {
    let mut last_err = None;
    for attempt in 1..=MAX_ATTEMPTS_PER_REQUEST {
        let result = client
            .get(url)
            .send()
            .context("requesting ListenBrainz")
            .and_then(|response| {
                let reset_in = rate_limit_reset_in(&response);
                if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    thread::sleep(reset_in.unwrap_or(Duration::from_secs(10)));
                    bail!("ListenBrainz rate limit hit");
                }
                let response = response
                    .error_for_status()
                    .context("ListenBrainz returned an error status")?;
                if rate_limit_remaining(&response) == Some(0) {
                    thread::sleep(reset_in.unwrap_or(Duration::from_secs(10)));
                }
                response.json::<T>().context("decoding ListenBrainz response")
            });

        match result {
            Ok(value) => return Ok(value),
            Err(err) if attempt < MAX_ATTEMPTS_PER_REQUEST => {
                let backoff = Duration::from_secs(2u64.pow(attempt));
                eprintln!(
                    "attempt {attempt}/{MAX_ATTEMPTS_PER_REQUEST} failed ({err:#}), retrying in {backoff:?}"
                );
                thread::sleep(backoff);
                last_err = Some(err);
            }
            Err(err) => last_err = Some(err),
        }
    }

    Err(last_err.unwrap_or_else(|| anyhow!("no request was attempted")))
}

fn header_number(response: &reqwest::blocking::Response, name: &str) -> Option<u64> {
    response.headers().get(name)?.to_str().ok()?.trim().parse().ok()
}

fn rate_limit_remaining(response: &reqwest::blocking::Response) -> Option<u64> {
    header_number(response, "X-RateLimit-Remaining")
}

/// One second of margin on top of what the server reports, since its
/// window and this machine's clock are not in step.
fn rate_limit_reset_in(response: &reqwest::blocking::Response) -> Option<Duration> {
    header_number(response, "X-RateLimit-Reset-In").map(|seconds| Duration::from_secs(seconds + 1))
}

#[cfg(test)]
mod tests {
    use super::{jump_to_history_start, next_cursor};

    #[test]
    fn an_empty_page_before_the_first_listen_jumps_to_it() {
        assert_eq!(jump_to_history_start(0, Some(1_272_796_229)), Some(1_272_796_228));
    }

    #[test]
    fn an_empty_page_inside_the_history_does_not_jump() {
        assert_eq!(jump_to_history_start(1_272_796_228, Some(1_272_796_229)), None);
        assert_eq!(jump_to_history_start(1_791_000_000, Some(1_272_796_229)), None);
        assert_eq!(jump_to_history_start(0, None), None);
    }

    #[test]
    fn a_full_page_re_reads_its_last_second() {
        assert_eq!(next_cursor(100, 500, true), 499);
    }

    #[test]
    fn a_page_that_reached_the_present_ends_on_its_newest_listen() {
        assert_eq!(next_cursor(100, 500, false), 500);
    }

    #[test]
    fn the_cursor_always_moves_forward() {
        // A full page that is all one second right after the cursor still advances.
        assert_eq!(next_cursor(100, 101, true), 101);
        assert_eq!(next_cursor(100, 100, false), 100);
    }
}
