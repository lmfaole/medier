//! Where an app's data tool finds its files.

use std::path::PathBuf;

/// The app's directory. Each tool is run from `apps/<app>/`; the named
/// environment variable overrides that, so a build can run elsewhere.
#[must_use]
pub fn app_root(variable: &str) -> PathBuf {
    std::env::var_os(variable).map_or_else(|| PathBuf::from("."), PathBuf::from)
}
