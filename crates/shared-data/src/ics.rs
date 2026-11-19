//! The events of an `.ics` calendar as `calendar-export` mirrors it from Nextcloud, for the sync tools that read one (the film
//! app's `Kino`, the music app's `Konserter`): the folded lines joined, the escapes undone, and the day and time of a start. What
//! an event means is each tool's; only the fields it asks for by name are read.

use chrono::NaiveDate;

/// One `VEVENT`, its lines unfolded.
pub struct Event<'a>(&'a str);

/// A calendar's text with folded lines joined: a line that starts with a space continues the one before it.
#[must_use]
pub fn unfolded(text: &str) -> String {
    text.replace("\r\n", "\n").replace("\n ", "").replace("\n\t", "")
}

fn unescaped(text: &str) -> String {
    text.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").replace("\\N", " ").replace("\\\\", "\\")
}

/// The events of an unfolded calendar (`unfolded`), in the order the file has them.
pub fn events(unfolded: &str) -> impl Iterator<Item = Event<'_>> {
    unfolded.split("BEGIN:VEVENT").skip(1).filter_map(|event| event.split("END:VEVENT").next()).map(Event)
}

impl Event<'_> {
    /// The value of a field, a parameter such as `;TZID=` ignored and the escapes undone.
    #[must_use]
    pub fn value(&self, name: &str) -> Option<String> {
        self.0.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key == name || key.starts_with(&format!("{name};"))).then(|| unescaped(value.trim()))
        })
    }

    #[must_use]
    pub fn cancelled(&self) -> bool {
        self.value("STATUS").is_some_and(|status| status.eq_ignore_ascii_case("CANCELLED"))
    }

    /// The day (`YYYY-MM-DD`) and the time (`HH:MM`, none for an all-day event) the event starts, or none for an unreadable start.
    #[must_use]
    pub fn start(&self) -> Option<(String, Option<String>)> {
        let value = self.value("DTSTART")?;
        let day = NaiveDate::parse_from_str(value.get(..8)?, "%Y%m%d").ok()?.to_string();
        let time = value.get(9..13).map(|digits| format!("{}:{}", &digits[..2], &digits[2..]));
        Some((day, time))
    }
}
