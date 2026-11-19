//! The HTTP plumbing every sync tool shares: one identified client with short timeouts, a retry for the answers
//! that are worth asking again, and the two limits that keep a slow source from using up a whole timer run.

use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use reqwest::blocking::{Client, Response};
use reqwest::StatusCode;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// The client of a tool: identified by `user_agent` and not left waiting for a slow server.
pub fn client(user_agent: &str) -> Result<Client> {
    Client::builder().user_agent(user_agent).connect_timeout(CONNECT_TIMEOUT).timeout(REQUEST_TIMEOUT).build().context("building HTTP client")
}

/// A server that is busy or failing may answer next time; any other answer is final.
#[must_use]
pub fn is_retryable(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// A failed request worth asking again: it timed out, could not connect, or never got a request out.
#[must_use]
pub fn is_transient(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request()
}

/// One second, then two, then four: long enough for a busy server, short enough for a timer run.
#[must_use]
pub fn backoff(attempt: u32) -> Duration {
    Duration::from_secs(1 << attempt.min(4))
}

/// A GET that is repeated, up to `attempts` times in all, when the connection fails or the server says it is busy.
/// The last answer is returned as it is, so the caller still decides what a 404 or a 500 means.
pub fn get_with_retry(client: &Client, address: &str, attempts: u32) -> Result<Response> {
    let mut attempt = 0;
    loop {
        let result = client.get(address).send();
        attempt += 1;
        let again = match &result {
            Ok(response) => is_retryable(response.status()),
            Err(error) => is_transient(error),
        };
        if !again || attempt >= attempts {
            return result.with_context(|| format!("asking {address}"));
        }
        std::thread::sleep(backoff(attempt - 1));
    }
}

/// How long a job may keep asking before it stops and leaves the rest for the next run.
pub struct Budget {
    deadline: Instant,
}

impl Budget {
    #[must_use]
    pub fn new(limit: Duration) -> Self {
        Self { deadline: Instant::now() + limit }
    }

    #[must_use]
    pub fn is_spent(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

/// Failures in a row. A source that is down fails every question; the job gives up after `limit` of them
/// instead of waiting for each one to time out.
pub struct FailureStreak {
    limit: u32,
    failed: u32,
}

impl FailureStreak {
    #[must_use]
    pub fn new(limit: u32) -> Self {
        Self { limit, failed: 0 }
    }

    /// Notes one answer; true when the streak has reached the limit.
    pub fn record(&mut self, succeeded: bool) -> bool {
        self.failed = if succeeded { 0 } else { self.failed + 1 };
        self.failed >= self.limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_busy_or_failing_server_is_asked_again() {
        assert!(is_retryable(StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable(StatusCode::BAD_GATEWAY));
        assert!(!is_retryable(StatusCode::NOT_FOUND));
        assert!(!is_retryable(StatusCode::OK));
    }

    #[test]
    fn the_wait_doubles_and_stops_growing() {
        assert_eq!([0, 1, 2, 3].map(backoff), [1, 2, 4, 8].map(Duration::from_secs));
        assert_eq!(backoff(40), Duration::from_secs(16));
    }

    #[test]
    fn a_budget_of_nothing_is_spent_at_once() {
        assert!(Budget::new(Duration::ZERO).is_spent());
        assert!(!Budget::new(Duration::from_secs(60)).is_spent());
    }

    #[test]
    fn a_streak_counts_failures_in_a_row_and_an_answer_resets_it() {
        let mut streak = FailureStreak::new(3);
        assert!(!streak.record(false));
        assert!(!streak.record(false));
        assert!(!streak.record(true));
        assert!(!streak.record(false));
        assert!(!streak.record(false));
        assert!(streak.record(false));
    }
}
