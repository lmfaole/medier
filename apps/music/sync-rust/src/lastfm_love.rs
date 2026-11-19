//! Loving a track on Last.fm, which needs what reading does not: a session the owner approved once and a signed
//! request. `lastfm-login-start` asks for a token, the owner approves it at last.fm, and `lastfm-login-finish` keeps the session
//! key in a file only the owner can read (`LASTFM_SESSION_FILE`, else `~/.config/lastfm.json`). The shared secret of the
//! API account is `LASTFM_API_SECRET`.

use std::io::Write;
use std::path::PathBuf;

use anyhow::{Context, Result};
use serde_json::{json, Value};

const SIGNED_OUT: [&str; 2] = ["format", "callback"];

fn env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("{name} is not set (the API account's page at last.fm/api/accounts)"))
}

fn session_path() -> PathBuf {
    std::env::var_os("LASTFM_SESSION_FILE").map_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config/lastfm.json"), PathBuf::from)
}

/// Last.fm's `api_sig`: the names and values in the order of the names, run together, then the secret, as an MD5 in hex.
/// `format` and `callback` are not signed.
#[must_use]
pub fn signature(params: &[(&str, &str)], secret: &str) -> String {
    let mut signed: Vec<_> = params.iter().filter(|(name, _)| !SIGNED_OUT.contains(name)).collect();
    signed.sort_by_key(|(name, _)| *name);
    let text = signed.iter().fold(String::new(), |text, (name, value)| text + name + value) + secret;
    format!("{:x}", md5::compute(text))
}

fn call(http: &reqwest::blocking::Client, post: bool, params: &[(&str, &str)]) -> Result<Value> {
    let (key, secret) = (env("LASTFM_API_KEY")?, env("LASTFM_API_SECRET")?);
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("api_key", &key));
    let sig = signature(&all, &secret);
    all.push(("api_sig", &sig));
    all.push(("format", "json"));
    let request = if post { http.post(crate::lastfm::API_URL).form(&all) } else { http.get(crate::lastfm::API_URL).query(&all) };
    let text = request.send().map_err(reqwest::Error::without_url).context("asking Last.fm")?.text().map_err(reqwest::Error::without_url).context("reading Last.fm's answer")?;
    if let Some((code, message)) = crate::lastfm::api_error(&text) {
        anyhow::bail!("Last.fm error {code}: {message}");
    }
    serde_json::from_str(&text).context("reading Last.fm's answer")
}

fn pending_path() -> PathBuf {
    session_path().with_file_name("lastfm-login-pending")
}

/// `lastfm-login-start`: asks for a token and prints the address to approve it at. The token is kept until `lastfm-login-finish`.
pub fn start() -> Result<()> {
    let http = crate::listenbrainz::http_client()?;
    let token = call(&http, false, &[("method", "auth.getToken")])?["token"].as_str().context("Last.fm gave no token")?.to_string();
    std::fs::write(pending_path(), &token).with_context(|| format!("writing {}", pending_path().display()))?;
    println!("Open this address in a browser and allow access, then run lastfm-login-finish:\n\nhttps://www.last.fm/api/auth/?api_key={}&token={token}", env("LASTFM_API_KEY")?);
    Ok(())
}

/// `lastfm-login-finish`: trades the approved token for the session and keeps it.
pub fn finish() -> Result<()> {
    let http = crate::listenbrainz::http_client()?;
    let token = std::fs::read_to_string(pending_path()).context("no login is waiting: run lastfm-login-start first")?;
    let session = call(&http, false, &[("method", "auth.getSession"), ("token", token.trim())])?["session"].clone();
    let key = session["key"].as_str().context("Last.fm gave no session key (was the address approved?)")?;
    save(&json!({ "name": session["name"], "session_key": key }))?;
    std::fs::remove_file(pending_path()).with_context(|| format!("removing {}", pending_path().display()))?;
    println!("Signed in to Last.fm; the session is in {}", session_path().display());
    Ok(())
}

fn save(session: &Value) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let path = session_path();
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&path).with_context(|| format!("opening {}", path.display()))?;
    file.write_all(serde_json::to_string_pretty(session)?.as_bytes()).with_context(|| format!("writing {}", path.display()))
}

pub fn session_key() -> Result<String> {
    let path = session_path();
    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}: run `likes-auth lastfm` first", path.display()))?;
    let session: Value = serde_json::from_str(&text).with_context(|| format!("reading {}", path.display()))?;
    session["session_key"].as_str().map(str::to_string).context("no session key kept: run `likes-auth lastfm` again")
}

/// Loves the track for the signed-in owner; loving one that is already loved changes nothing.
pub fn love(http: &reqwest::blocking::Client, session_key: &str, artist: &str, track: &str) -> Result<()> {
    call(http, true, &[("method", "track.love"), ("artist", artist), ("track", track), ("sk", session_key)]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_signature_is_the_md5_of_the_sorted_pairs_and_the_secret_without_format() {
        // md5("api_keyabcmethodauth.getTokensecret")
        let expected = format!("{:x}", md5::compute("api_keyabcmethodauth.getTokensecret"));
        assert_eq!(signature(&[("method", "auth.getToken"), ("api_key", "abc"), ("format", "json")], "secret"), expected);
        assert_eq!(signature(&[("api_key", "abc"), ("method", "auth.getToken")], "secret"), expected);
        assert_eq!(signature(&[], ""), "d41d8cd98f00b204e9800998ecf8427e");
    }
}
