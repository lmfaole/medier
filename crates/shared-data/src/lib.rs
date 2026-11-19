//! Shared building blocks for the apps' Rust data tools. Each app still owns
//! its own domain logic (parsing, ListenBrainz fetching, aggregation); this
//! crate only owns the plumbing that was previously copy-pasted between them.

#[cfg(feature = "local-sqlite")]
pub mod app_db;
pub mod apple_export;
pub mod apple_stores_export;
pub mod app_root;
pub mod batch;
#[cfg(feature = "local-sqlite")]
pub mod diff;
pub mod fingerprint;
pub mod http;
pub mod ics;
pub mod job;
pub mod json_file;
pub mod landed;
#[cfg(feature = "local-sqlite")]
pub mod migrations;
#[cfg(feature = "local-sqlite")]
pub mod purchases;
pub mod raw;
#[cfg(feature = "local-sqlite")]
pub mod local_db;
pub mod spotify_export;
pub mod window;
#[cfg(feature = "local-sqlite")]
pub mod sqlite_client;
pub mod sql_script;
pub mod text;
pub mod trakt;
#[cfg(feature = "local-sqlite")]
pub mod tmdb;
#[cfg(feature = "local-sqlite")]
pub mod log_file;
#[cfg(feature = "local-sqlite")]
pub mod watch_log;
#[cfg(feature = "local-sqlite")]
pub mod shelf;
#[cfg(feature = "local-sqlite")]
pub mod static_api;
