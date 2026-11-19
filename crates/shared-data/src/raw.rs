//! Where a source's originals are landed: `.data/raw/<source>/<date>/`, saved
//! unchanged before anything reads them. With no backup, this is the only copy a
//! rebuild can start from, so a tool never edits, reuses or deletes a landed folder.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::NaiveDate;

/// The folder for `source` on `date` under `DATA_RAW`, else `../../.data/raw` (tools run from `apps/<app>/`).
pub fn landing_dir(source: &str, date: NaiveDate) -> Result<PathBuf> {
    landing_dir_in(&raw_root(), source, date)
}

/// Where a pull of `source` made on `date` lands, without creating it: for a tool that resumes a
/// pull that was interrupted, which is the one case a dated folder may already hold files.
pub fn landing_path(source: &str, date: NaiveDate) -> Result<PathBuf> {
    landing_path_in(&raw_root(), source, date)
}

fn raw_root() -> PathBuf {
    std::env::var_os("DATA_RAW").map_or_else(|| PathBuf::from("../../.data/raw"), PathBuf::from)
}

fn landing_path_in(root: &Path, source: &str, date: NaiveDate) -> Result<PathBuf> {
    Ok(source_root_in(root, source)?.join(date.to_string()))
}

fn source_root_in(root: &Path, source: &str) -> Result<PathBuf> {
    if !is_source_name(source) {
        bail!("{source:?} is not a source name: use lowercase letters, digits and dashes, starting with a letter");
    }
    Ok(root.join(source))
}

/// Creates and returns `<root>/<source>/<date>/`. An existing folder that already
/// holds files is refused: a second pull is a new dated folder, never a merge.
pub fn landing_dir_in(root: &Path, source: &str, date: NaiveDate) -> Result<PathBuf> {
    let directory = landing_path_in(root, source, date)?;
    std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
    let occupied = std::fs::read_dir(&directory)
        .with_context(|| format!("reading {}", directory.display()))?
        .next()
        .is_some();
    if occupied {
        bail!("{} already holds files; land a new pull in a folder of its own date", directory.display());
    }
    Ok(directory)
}

/// The newest landed copy of each file of `source`, across all its dated folders: by file name, its path and when it
/// was written (unix seconds). A tool asks a source again only for what is due, judged by this.
pub fn newest_landed(source: &str) -> Result<std::collections::HashMap<String, (PathBuf, i64)>> {
    Ok(newest_in(&source_root_in(&raw_root(), source)?))
}

fn newest_in(source_root: &Path) -> std::collections::HashMap<String, (PathBuf, i64)> {
    let mut newest: std::collections::HashMap<String, (PathBuf, std::time::Duration)> = std::collections::HashMap::new();
    let files = std::fs::read_dir(source_root).into_iter().flatten().flatten().flat_map(|day| std::fs::read_dir(day.path()).into_iter().flatten().flatten());
    for file in files {
        let Some(at) = file.metadata().and_then(|meta| meta.modified()).ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()) else { continue };
        let name = file.file_name().to_string_lossy().into_owned();
        if newest.get(&name).is_none_or(|(_, kept)| at > *kept) {
            newest.insert(name, (file.path(), at));
        }
    }
    newest.into_iter().map(|(name, (path, at))| (name, (path, i64::try_from(at.as_secs()).unwrap_or(i64::MAX)))).collect()
}

fn is_source_name(source: &str) -> bool {
    let mut characters = source.chars();
    characters.next().is_some_and(|first| first.is_ascii_lowercase())
        && characters.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("raw-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn day() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 14).unwrap()
    }

    #[test]
    fn a_landing_dir_is_created_under_the_source_and_date() {
        let root = scratch("create");

        let directory = landing_dir_in(&root, "spotify", day()).unwrap();

        assert_eq!(directory, root.join("spotify").join("2026-10-14"));
        assert!(directory.is_dir());
    }

    #[test]
    fn a_second_pull_on_the_same_day_is_refused_when_files_exist() {
        let root = scratch("twice");
        let directory = landing_dir_in(&root, "spotify", day()).unwrap();
        std::fs::write(directory.join("Streaming_History_Audio_2025.json"), "[]").unwrap();

        assert!(landing_dir_in(&root, "spotify", day()).is_err());
        assert!(directory.join("Streaming_History_Audio_2025.json").exists());
    }

    #[test]
    fn an_empty_existing_dir_is_reused() {
        let root = scratch("empty");
        landing_dir_in(&root, "spotify", day()).unwrap();

        assert!(landing_dir_in(&root, "spotify", day()).is_ok());
    }

    #[test]
    fn landing_path_names_the_folder_without_creating_it_and_checks_the_name() {
        let root = scratch("path");

        assert_eq!(landing_path_in(&root, "lastfm", day()).unwrap(), root.join("lastfm").join("2026-10-14"));
        assert!(!root.exists());
        assert!(landing_path_in(&root, "../escape", day()).is_err());
    }

    #[test]
    fn a_source_name_with_a_slash_or_dots_is_refused() {
        let root = scratch("names");
        for name in ["../escape", "a/b", "", "Spotify", "1password", "a.b"] {
            assert!(landing_dir_in(&root, name, day()).is_err(), "{name:?} should be refused");
        }
        assert!(!root.exists());
    }

    #[test]
    fn the_newest_copy_of_a_file_is_the_one_written_last_of_all_the_days() {
        let root = scratch("newest");
        for (folder, text) in [("2026-10-01", "old"), ("2026-11-01", "new")] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
            std::fs::write(root.join(folder).join("tv-1.json"), text).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        std::fs::write(root.join("2026-10-01").join("tv-2.json"), "only").unwrap();
        let newest = newest_in(&root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(newest.len(), 2);
        assert!(newest["tv-1.json"].0.ends_with("2026-11-01/tv-1.json"));
        assert!(newest["tv-2.json"].0.ends_with("2026-10-01/tv-2.json"));
        assert!(newest_in(Path::new("/nonexistent")).is_empty());
    }
}
