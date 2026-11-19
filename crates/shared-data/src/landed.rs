//! The zip files landed by hand under `.data/raw/<source>/<date>/` (`npm run land -- <source> <file>`), and the text of a file
//! inside one, through as many zips-in-zips as an export has.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::NaiveDate;

/// Every landed zip of the source, newest day first.
pub fn zips(source: &str) -> Result<Vec<PathBuf>> {
    let root = crate::raw::landing_path(source, chrono::Utc::now().date_naive())?.parent().map(PathBuf::from).unwrap_or_default();
    let mut days: Vec<PathBuf> = std::fs::read_dir(&root)
        .with_context(|| format!("reading {}: land the export first, `npm run land -- {source} <file>`", root.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir() && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.parse::<NaiveDate>().is_ok()))
        .collect();
    days.sort();
    Ok(days
        .iter()
        .rev()
        .flat_map(|day| std::fs::read_dir(day).into_iter().flatten().filter_map(|entry| entry.ok().map(|entry| entry.path())).filter(|path| path.extension().is_some_and(|extension| extension == "zip")))
        .collect())
}

fn entry_in<R: Read + std::io::Seek>(archive: &mut zip::ZipArchive<R>, suffix: &str) -> Option<Vec<u8>> {
    let name = archive.file_names().filter_map(std::result::Result::ok).find(|name| name.ends_with(suffix))?.to_string();
    let mut bytes = Vec::new();
    archive.by_name(&name).ok()?.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// The text of the file whose name ends with the last of `suffixes`, found by opening the zip, then the entry named by
/// each earlier suffix as a zip in turn. None when the zip is another part of the export.
#[must_use]
pub fn text_in(zip: &Path, suffixes: &[&str]) -> Option<String> {
    let (last, outer) = suffixes.split_last()?;
    let mut bytes = std::fs::read(zip).ok()?;
    for suffix in outer {
        bytes = entry_in(&mut zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?, suffix)?;
    }
    String::from_utf8(entry_in(&mut zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?, last)?).ok()
}
