//! `books-sync apple`: the books and audiobooks bought in Apple Books, from Apple's data export (landed by hand,
//! `npm run land -- apple-media <zip>`, both parts; the purchase list is in `Apple_Media_Services.zip`). Each is `owned`
//! once, by Apple's number for the item, on the day it was bought (the same title bought twice is one line). The price,
//! the invoice, the device and the account are not read, and neither are the apps and the films in the same list.

use anyhow::{Context, Result};
use shared_data::shelf::{Entry, Ledger, Session};

const SOURCE: &str = "apple-media";
const OUTER: &str = "Apple_Media_Services.zip";
const PURCHASES: &str = "Store Transaction Purchase and Free Apps History.csv";

/// The format shown under «Eier»: what the purchase's content type says it is.
fn format_of(content_type: &str) -> Option<&'static str> {
    match content_type {
        "Books" => Some("apple books"),
        "Audiobooks" => Some("apple lydbok"),
        _ => None,
    }
}

/// The books of the purchase list, once each, in the order they were bought.
pub fn books_in(text: &str) -> Result<Vec<Entry>> {
    let mut reader = csv::Reader::from_reader(text.as_bytes());
    let headers = reader.headers().context("reading the purchase list")?.clone();
    let column = |name: &str| headers.iter().position(|header| header == name);
    let (Some(kind), Some(reference), Some(title), Some(date)) = (column("Content Type"), column("Item Reference Number"), column("Item Description"), column("Item Purchased Date")) else {
        anyhow::bail!("the purchase list lacks a column: Content Type, Item Reference Number, Item Description, Item Purchased Date");
    };
    let mut entries: Vec<Entry> = Vec::new();
    for record in reader.records().filter_map(std::result::Result::ok) {
        let (Some(format), Some(reference), Some(title)) = (format_of(record.get(kind).unwrap_or_default()), record.get(reference).filter(|value| !value.is_empty()), record.get(title).map(str::trim).filter(|value| !value.is_empty())) else { continue };
        let source = format!("applebooks:{reference}");
        if entries.iter().any(|entry| entry.source.as_deref() == Some(source.as_str())) {
            continue;
        }
        entries.push(Entry { title: title.to_string(), status: "owned".to_string(), on_date: record.get(date).and_then(|stamp| stamp.get(..10)).map(str::to_string), source: Some(source), format: Some(format.to_string()), ..Entry::default() });
    }
    entries.sort_by(|left, right| left.on_date.cmp(&right.on_date));
    Ok(entries)
}

pub fn run(session: &Session) -> Result<()> {
    let text = shared_data::landed::zips(SOURCE)?
        .iter()
        .find_map(|zip| shared_data::landed::text_in(zip, &[OUTER, PURCHASES]))
        .with_context(|| format!("no landed zip under the `{SOURCE}` source holds {PURCHASES}"))?;
    let books = books_in(&text)?;
    let added = session.shelf.append_new_in(Ledger::Collection, &session.db, &session.collection, &books)?;
    println!("apple: {} books and audiobooks, {added} added to the collection", books.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn books_and_audiobooks_are_owned_once_on_the_day_bought_and_apps_and_films_are_left_out() {
        let text = "Content Type,Item Reference Number,Item Description,Item Purchased Date,Invoice Total Amount\n\
            Audiobooks,11,The Souls of Black Folk,2024-12-23T10:00:00.000Z,99\n\
            Audiobooks,11,The Souls of Black Folk,2024-12-23T10:00:05.000Z,99\n\
            Books,22,  Severance ,2025-02-10T08:00:00.000Z,0\n\
            Movie Rentals,33,Titane,2024-12-25T00:00:00.000Z,39\n\
            iOS and tvOS Apps,44,Some App,2025-01-01T00:00:00.000Z,0\n";
        let books = books_in(text).expect("books");
        let seen: Vec<_> = books.iter().map(|book| (book.title.as_str(), book.format.as_deref(), book.on_date.as_deref(), book.source.as_deref())).collect();
        assert_eq!(seen, vec![("The Souls of Black Folk", Some("apple lydbok"), Some("2024-12-23"), Some("applebooks:11")), ("Severance", Some("apple books"), Some("2025-02-10"), Some("applebooks:22"))]);
    }

    #[test]
    fn a_list_without_the_columns_is_an_error() {
        assert!(books_in("a,b\n1,2\n").is_err());
    }
}
