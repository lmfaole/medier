//! Source fingerprints for `meta.json`. Each app's `scripts/check-api-sync`
//! recomputes them without cargo and compares, which catches a `data/` file
//! edited without rebuilding the API. FNV-1a 64-bit was chosen because it is
//! short enough to keep identical in Rust and TypeScript without a dependency.

use std::path::Path;

use anyhow::{Context, Result};

/// One source file and its fingerprint, sorted by name in every list.
pub type SourceFingerprints = Vec<(String, String)>;

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[must_use]
pub fn fnv1a(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(FNV_OFFSET_BASIS, |hash, &byte| (hash ^ u64::from(byte)).wrapping_mul(FNV_PRIME))
}

/// The fingerprint as `meta.json` stores it: fixed-width lower-case hex.
#[must_use]
pub fn fingerprint(bytes: &[u8]) -> String {
    format!("{:016x}", fnv1a(bytes))
}

fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).with_context(|| format!("could not read {}", path.display()))
}

/// Every `*.json` directly in `directory`, keyed by file name.
pub fn json_files_in(directory: &Path) -> Result<SourceFingerprints> {
    let mut fingerprints = Vec::new();
    for entry in std::fs::read_dir(directory).with_context(|| format!("could not read {}", directory.display()))? {
        let path = entry?.path();
        if path.extension().and_then(|suffix| suffix.to_str()) != Some("json") {
            continue;
        }
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        fingerprints.push((name, fingerprint(&read(&path)?)));
    }
    fingerprints.sort();
    Ok(fingerprints)
}

/// The named files under `root`, keyed by the path as given.
pub fn files(root: &Path, relative_paths: &[&str]) -> Result<SourceFingerprints> {
    let mut fingerprints = relative_paths
        .iter()
        .map(|relative| Ok(((*relative).to_string(), fingerprint(&read(&root.join(relative))?))))
        .collect::<Result<SourceFingerprints>>()?;
    fingerprints.sort();
    Ok(fingerprints)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `scripts/check-api-sync` must produce these same values; if the two sides
    // ever differ, every app's `check:api` reports every file as stale.
    #[test]
    fn fnv1a_matches_the_reference_vector() {
        assert_eq!(fingerprint(b""), "cbf29ce484222325");
        assert_eq!(fingerprint(b"hello"), "a430d84680aabd0b");
    }

    #[test]
    fn only_json_files_count_and_they_come_sorted_by_name() {
        let directory = std::env::temp_dir().join("shared-data-fingerprint-test");
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("b.json"), "hello").unwrap();
        std::fs::write(directory.join("a.json"), "").unwrap();
        std::fs::write(directory.join("notes.txt"), "ignored").unwrap();

        let fingerprints = json_files_in(&directory).unwrap();
        assert_eq!(
            fingerprints,
            [("a.json".to_string(), "cbf29ce484222325".to_string()), ("b.json".to_string(), "a430d84680aabd0b".to_string())]
        );
        assert_eq!(files(&directory, &["b.json", "a.json"]).unwrap(), fingerprints);
    }
}
