//! JSON files on disk: the sources in `data/` and the static API the tools
//! write to `web/public/api/`.

use std::path::Path;

use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};

/// Whether a written file ends in a newline. The API files are compared byte
/// for byte, and the apps differ here, so each states which it writes.
#[derive(Clone, Copy, Debug)]
pub enum Ending {
    None,
    Newline,
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let text = std::fs::read_to_string(path).with_context(|| format!("could not read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("invalid JSON in {}", path.display()))
}

/// Writes `<directory>/<name>.json`, pretty-printed.
pub fn write_json<T: Serialize>(directory: &Path, name: &str, value: &T, ending: Ending) -> Result<()> {
    let path = directory.join(format!("{name}.json"));
    let mut text = serde_json::to_string_pretty(value).with_context(|| format!("could not serialise {name}.json"))?;
    if matches!(ending, Ending::Newline) {
        text.push('\n');
    }
    std::fs::write(&path, text).with_context(|| format!("could not write {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_written_file_reads_back_with_the_ending_it_was_given() {
        let directory = std::env::temp_dir().join("shared-data-json-file-test");
        std::fs::create_dir_all(&directory).unwrap();
        write_json(&directory, "plain", &[1, 2], Ending::None).unwrap();
        write_json(&directory, "line", &[1, 2], Ending::Newline).unwrap();

        assert_eq!(std::fs::read_to_string(directory.join("plain.json")).unwrap(), "[\n  1,\n  2\n]");
        assert_eq!(std::fs::read_to_string(directory.join("line.json")).unwrap(), "[\n  1,\n  2\n]\n");
        assert_eq!(read_json::<Vec<i64>>(&directory.join("line.json")).unwrap(), [1, 2]);
    }
}
