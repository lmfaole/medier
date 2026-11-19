//! The games and audiobooks the owner bought, from `.data/mail-purchases.json` (`MAIL_PURCHASES` names another file), which
//! `npm run mail:purchases` makes from the receipts `mail-ingest` landed. Each purchase is added to the app's collection as `owned`
//! once, by its `source` (`mail:nintendo:<title>`), so a line the owner has edited is never written again and a receipt that
//! arrives twice is one line. Only the title, the format and the day are read; there is no price or account in the file.

use anyhow::{Context, Result};
use serde_json::Value;

use crate::app_db::path_from_env;
use crate::shelf::{Entry, Ledger, Session};

/// Which list of the file an app takes: `games` or `books`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Games,
    Books,
}

impl Kind {
    const fn key(self) -> &'static str {
        match self {
            Self::Games => "games",
            Self::Books => "books",
        }
    }
}

/// The collection lines of one list: owned, in the format and on the day the file says, with the purchase's source.
#[must_use]
pub fn entries(json: &Value, kind: Kind) -> Vec<Entry> {
    json[kind.key()]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|purchase| {
                    Some(Entry {
                        title: purchase["title"].as_str()?.trim().to_string(),
                        status: "owned".to_string(),
                        on_date: purchase["date"].as_str().map(str::to_string),
                        source: Some(purchase["source"].as_str()?.to_string()),
                        format: purchase["format"].as_str().map(str::to_string),
                        ..Entry::default()
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The `purchases` job of an app: its list of the file, added to the collection and imported.
pub fn add(session: &Session, kind: Kind) -> Result<()> {
    let file = path_from_env("MAIL_PURCHASES", "../../.data/mail-purchases.json");
    let json: Value = serde_json::from_slice(&std::fs::read(&file).with_context(|| format!("reading {}: run `npm run mail:purchases -- --apply`", file.display()))?)
        .with_context(|| format!("parsing {}", file.display()))?;
    let found = entries(&json, kind);
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &found)?;
    println!("purchases: {} {}, {added} added to the collection", found.len(), kind.key());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_purchase_is_an_owned_line_with_its_source_and_a_list_with_none_is_empty() {
        let json: Value = serde_json::from_str(r#"{"games": [{"title": " Cider ", "format": "itch.io", "date": "2024-09-23", "source": "mail:itch:cider"}, {"title": "No source"}], "books": []}"#).unwrap_or_else(|error| panic!("{error}"));
        let games = entries(&json, Kind::Games);
        assert_eq!(games.len(), 1);
        assert_eq!((games[0].title.as_str(), games[0].status.as_str(), games[0].format.as_deref(), games[0].on_date.as_deref(), games[0].source.as_deref()), ("Cider", "owned", Some("itch.io"), Some("2024-09-23"), Some("mail:itch:cider")));
        assert!(entries(&json, Kind::Books).is_empty());
        assert!(entries(&Value::Null, Kind::Games).is_empty());
    }
}
