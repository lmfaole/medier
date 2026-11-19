//! The owner's Spotify sign-in and the calls the likes sync makes. The app's Client ID and secret are in
//! `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, its redirect address (a loopback one, registered in the
//! developer dashboard) in `SPOTIFY_REDIRECT_URI`. `likes-auth spotify` opens the approval once and catches the
//! answer on that address; the tokens are kept in a file only the owner can read (`SPOTIFY_TOKEN_FILE`, else
//! `~/.config/spotify.json`) and the access token is renewed whenever it is within a minute of running out.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use shared_data::job::Args;

const ACCOUNTS: &str = "https://accounts.spotify.com";
pub const API: &str = "https://api.spotify.com/v1";
const SCOPES: &str = "user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-follow-read user-read-recently-played";
/// The wait between two searches of the picture jobs, so Spotify's rate limit is not met.
pub const SEARCH_PAUSE: Duration = Duration::from_millis(300);
/// The `<limit>` a picture job takes: how many things it asks Spotify about.
pub fn limit_of(args: &Args) -> Result<usize> {
    args.positional(0).parse().context("the limit must be a number")
}

const MAX_RATE_LIMIT_RETRIES: u32 = 5;

fn env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("{name} is not set (the app's page in the Spotify developer dashboard)"))
}

pub fn token_path() -> PathBuf {
    std::env::var_os("SPOTIFY_TOKEN_FILE").map_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config/spotify.json"), PathBuf::from)
}

pub fn authorize_url(client_id: &str, redirect: &str, state: &str) -> Result<String> {
    let url = reqwest::Url::parse_with_params(
        &format!("{ACCOUNTS}/authorize"),
        &[("client_id", client_id), ("response_type", "code"), ("redirect_uri", redirect), ("scope", SCOPES), ("state", state)],
    )
    .context("building the Spotify approval address")?;
    Ok(url.into())
}

/// The `code` of the request Spotify sends the browser to, refused when its `state` is not the one asked with.
pub fn code_from_request(request_line: &str, state: &str) -> Result<String> {
    let target = request_line.split_whitespace().nth(1).context("an empty request on the redirect address")?;
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).context("reading the redirect address")?;
    let query = |name: &str| url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned());
    if let Some(error) = query("error") {
        bail!("Spotify refused the approval: {error}");
    }
    if query("state").as_deref() != Some(state) {
        bail!("the answer did not carry the state it was asked with");
    }
    query("code").context("the answer carried no code")
}

/// The token answer as the file keeps it. A renewal does not always repeat the refresh token, and the old one stays good then.
#[must_use]
pub fn kept(answer: &Value, previous: &Value, now: i64) -> Value {
    let refresh = if answer["refresh_token"].is_string() { &answer["refresh_token"] } else { &previous["refresh_token"] };
    json!({"access_token": answer["access_token"], "refresh_token": refresh, "expires_at": now + answer["expires_in"].as_i64().unwrap_or(0)})
}

#[must_use]
pub fn needs_renewal(kept: &Value, now: i64) -> bool {
    kept["expires_at"].as_i64().is_none_or(|at| at - now < 60)
}

fn save(token: &Value) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let path = token_path();
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&path).with_context(|| format!("opening {}", path.display()))?;
    file.write_all(serde_json::to_string_pretty(token)?.as_bytes()).with_context(|| format!("writing {}", path.display()))
}

pub fn client() -> Result<reqwest::blocking::Client> {
    crate::listenbrainz::http_client()
}

fn token_request(http: &reqwest::blocking::Client, form: &[(&str, &str)]) -> Result<Value> {
    http.post(format!("{ACCOUNTS}/api/token"))
        .basic_auth(env("SPOTIFY_CLIENT_ID")?, Some(env("SPOTIFY_CLIENT_SECRET")?))
        .form(form)
        .send()
        .map_err(reqwest::Error::without_url)
        .context("asking Spotify for a token")?
        .error_for_status()
        .map_err(reqwest::Error::without_url)
        .context("Spotify refused the token request (run `likes-auth spotify` again?)")?
        .json()
        .map_err(reqwest::Error::without_url)
        .context("reading Spotify's token")
}

fn random_state() -> Result<String> {
    use std::fmt::Write as _;
    use std::io::Read;
    let mut bytes = [0_u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut bytes)).context("reading /dev/urandom")?;
    Ok(bytes.iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02x}");
        hex
    }))
}

/// `likes-auth spotify`: prints the address to approve at and waits for the browser to come back to the redirect address.
pub fn login() -> Result<()> {
    let redirect = env("SPOTIFY_REDIRECT_URI")?;
    let address = reqwest::Url::parse(&redirect).context("SPOTIFY_REDIRECT_URI is not an address")?;
    let host = address.host_str().context("the redirect address has no host")?;
    let port = address.port().context("the redirect address has no port")?;
    let listener = TcpListener::bind((host, port)).with_context(|| format!("listening on {host}:{port}"))?;
    let state = random_state()?;
    println!("Open this address in a browser and approve:\n\n{}\n", authorize_url(&env("SPOTIFY_CLIENT_ID")?, &redirect, &state)?);
    let (mut stream, _) = listener.accept().context("waiting for the browser")?;
    let mut request_line = String::new();
    BufReader::new(&stream).read_line(&mut request_line).context("reading the browser's request")?;
    let code = code_from_request(&request_line, &state);
    let page = if code.is_ok() { "Signed in to Spotify. You can close this tab." } else { "The approval did not go through; see the terminal." };
    let body = format!("<!doctype html><meta charset=utf-8><title>Spotify</title><p>{page}");
    // The browser only needs something to show; a failed write changes nothing about the sign-in.
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let answer = token_request(&client()?, &[("grant_type", "authorization_code"), ("code", &code?), ("redirect_uri", &redirect)])?;
    save(&kept(&answer, &Value::Null, chrono::Utc::now().timestamp()))?;
    println!("Signed in; the tokens are in {}", token_path().display());
    Ok(())
}

fn pending_path() -> PathBuf {
    token_path().with_file_name("spotify-login-pending")
}

/// `spotify-login-start`: the same approval as `login`, for when the browser is not on this machine. It keeps the state
/// it asked with and prints the address; the browser ends on a page that fails to load, and `spotify-login-finish` is given
/// that page's address.
pub fn start() -> Result<()> {
    let state = random_state()?;
    std::fs::write(pending_path(), &state).with_context(|| format!("writing {}", pending_path().display()))?;
    println!("Open this address in a browser and approve; the page it ends on will not load, copy its address:\n\n{}", authorize_url(&env("SPOTIFY_CLIENT_ID")?, &env("SPOTIFY_REDIRECT_URI")?, &state)?);
    Ok(())
}

/// The path and query of an address the browser was sent to, as a request line `code_from_request` reads.
fn request_line(address: &str) -> Result<String> {
    let url = reqwest::Url::parse(address.trim()).context("that is not an address")?;
    Ok(format!("GET {}?{} HTTP/1.1", url.path(), url.query().unwrap_or_default()))
}

/// `spotify-login-finish <address>`: the code in the address the approval ended on, exchanged for the tokens.
pub fn finish(address: &str) -> Result<()> {
    let state = std::fs::read_to_string(pending_path()).context("no login is waiting: run spotify-login-start first")?;
    let code = code_from_request(&request_line(address)?, state.trim())?;
    let answer = token_request(&client()?, &[("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &env("SPOTIFY_REDIRECT_URI")?)])?;
    save(&kept(&answer, &Value::Null, chrono::Utc::now().timestamp()))?;
    std::fs::remove_file(pending_path()).with_context(|| format!("removing {}", pending_path().display()))?;
    println!("Signed in; the tokens are in {}", token_path().display());
    Ok(())
}

/// The access token, renewed first when it is about to run out.
pub fn access_token(http: &reqwest::blocking::Client) -> Result<String> {
    let path = token_path();
    let text = std::fs::read_to_string(&path).with_context(|| format!("reading {}: run `likes-auth spotify` first", path.display()))?;
    let mut token: Value = serde_json::from_str(&text).with_context(|| format!("reading {}", path.display()))?;
    let now = chrono::Utc::now().timestamp();
    if needs_renewal(&token, now) {
        let refresh = token["refresh_token"].as_str().context("no refresh token kept: run `likes-auth spotify` again")?.to_string();
        let answer = token_request(http, &[("grant_type", "refresh_token"), ("refresh_token", &refresh)])?;
        token = kept(&answer, &token, now);
        save(&token)?;
    }
    token["access_token"].as_str().map(str::to_string).context("no access token kept: run `likes-auth spotify` again")
}

/// One call, waiting out a rate limit (`Retry-After`) a few times before giving up. The body is the answer's text.
pub fn send(http: &reqwest::blocking::Client, token: &str, method: &reqwest::Method, url: &str) -> Result<String> {
    let mut waits = 0;
    loop {
        let response = http.request(method.clone(), url).bearer_auth(token).send().map_err(reqwest::Error::without_url).context("asking Spotify")?;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && waits < MAX_RATE_LIMIT_RETRIES {
            waits += 1;
            let seconds = response.headers().get("retry-after").and_then(|value| value.to_str().ok()).and_then(|value| value.parse().ok()).unwrap_or(5);
            std::thread::sleep(Duration::from_secs(seconds));
            continue;
        }
        let status = response.status();
        let text = response.text().map_err(reqwest::Error::without_url).context("reading Spotify's answer")?;
        if !status.is_success() {
            bail!("Spotify answered {status}: {}", text.chars().take(200).collect::<String>());
        }
        return Ok(text);
    }
}

/// Spotify's catalogue search for `query` among `kind`s (`artist`, `album`), the answer as JSON.
pub fn search(http: &reqwest::blocking::Client, token: &str, query: &str, kind: &str) -> Result<Value> {
    let url = reqwest::Url::parse_with_params(&format!("{API}/search"), &[("q", query), ("type", kind), ("limit", "10")]).context("building the Spotify search address")?;
    serde_json::from_str(&send(http, token, &reqwest::Method::GET, url.as_str())?).context("reading Spotify's search")
}

/// The address of the picture to keep from a Spotify `images` list: the smallest one at least 250 px wide (what a cover is shown at), else the widest.
#[must_use]
pub fn picture_address(images: &Value) -> Option<String> {
    let list = images.as_array()?;
    let width = |image: &&Value| image["width"].as_i64().unwrap_or(0);
    let chosen = list.iter().filter(|image| width(image) >= 250).min_by_key(width).or_else(|| list.iter().max_by_key(width))?;
    chosen["url"].as_str().filter(|address| address.starts_with("https://i.scdn.co/image/")).map(str::to_string)
}

/// One page of a list read by offset. `count` is how many items Spotify sent, which is more than `items` when a local file or a withdrawn entry has no id.
#[derive(Debug, PartialEq, Eq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: usize,
    pub count: usize,
}

/// Every page from `get(offset)` (landing each through `land`) until the total Spotify announced is in hand; fewer than announced changes nothing.
pub fn collect_pages<T>(
    page_size: usize,
    what: &str,
    mut get: impl FnMut(usize) -> Result<String>,
    mut land: impl FnMut(usize, &str) -> Result<()>,
    parse: impl Fn(&str) -> Result<Page<T>>,
) -> Result<Vec<T>> {
    let mut items = Vec::new();
    let mut offset = 0;
    loop {
        let text = get(offset)?;
        land(offset / page_size + 1, &text)?;
        let page = parse(&text)?;
        offset += page.count;
        items.extend(page.items);
        if page.count == 0 || offset >= page.total {
            if offset != page.total {
                bail!("Spotify announced {} {what} and gave {offset}", page.total);
            }
            return Ok(items);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_code_is_read_from_the_redirect_request_and_only_with_the_state_asked() {
        assert_eq!(code_from_request("GET /callback?code=abc%20d&state=s1 HTTP/1.1", "s1").unwrap(), "abc d");
        assert!(code_from_request("GET /callback?code=abc&state=other HTTP/1.1", "s1").is_err());
        assert!(code_from_request("GET /callback?state=s1 HTTP/1.1", "s1").is_err());
        assert!(code_from_request("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1").unwrap_err().to_string().contains("access_denied"));
    }

    #[test]
    fn the_address_the_approval_ends_on_is_read_like_the_request_that_would_have_come() {
        let line = request_line("http://127.0.0.1:43897/callback?code=abc&state=s1\n").unwrap();
        assert_eq!(code_from_request(&line, "s1").unwrap(), "abc");
        assert!(request_line("not an address").is_err());
    }

    #[test]
    fn a_renewal_without_a_refresh_token_keeps_the_old_one() {
        let previous = json!({"access_token": "old", "refresh_token": "r1", "expires_at": 0});
        let renewed = kept(&json!({"access_token": "new", "expires_in": 3600}), &previous, 1000);
        assert_eq!(renewed, json!({"access_token": "new", "refresh_token": "r1", "expires_at": 4600}));
        assert_eq!(kept(&json!({"access_token": "n", "refresh_token": "r2", "expires_in": 1}), &previous, 0)["refresh_token"], "r2");
    }

    #[test]
    fn a_token_is_renewed_in_its_last_minute_and_not_before() {
        assert!(needs_renewal(&json!({"expires_at": 1059}), 1000));
        assert!(!needs_renewal(&json!({"expires_at": 1061}), 1000));
        assert!(needs_renewal(&json!({}), 1000));
    }
}
