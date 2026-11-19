//! Which periods a job recomputes. Data that is only ever appended never
//! changes a finished year, and "all time" moves too slowly to be worth reading
//! the whole history for every day: each job takes the target it is scheduled
//! for instead of recomputing everything.

use anyhow::{bail, Result};
use chrono::{Datelike, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    /// The year in progress (and the one before it in January).
    CurrentYear,
    /// The windows that move with the clock, such as `last-N-days`.
    Rolling,
    /// Every calendar year with data, for a backfill or a corrected import.
    Years,
    /// The whole history.
    All,
}

impl Target {
    pub fn parse(name: &str) -> Result<Self> {
        match name {
            "current-year" => Ok(Self::CurrentYear),
            "rolling" => Ok(Self::Rolling),
            "years" => Ok(Self::Years),
            "all" => Ok(Self::All),
            other => bail!("unknown target {other:?}, expected current-year, rolling, years or all"),
        }
    }
}

/// The years new rows can still land in. In January the year before is
/// included, so its last days are not left as they were at the previous
/// year's final run.
#[must_use]
pub fn current_years(today: NaiveDate) -> Vec<i32> {
    if today.month() == 1 {
        vec![today.year() - 1, today.year()]
    } else {
        vec![today.year()]
    }
}

/// The first second of `year`, UTC.
#[must_use]
pub fn year_start(year: i32) -> i64 {
    NaiveDate::from_ymd_opt(year, 1, 1)
        .and_then(|date| date.and_hms_opt(0, 0, 0))
        .map_or(0, |moment| moment.and_utc().timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn a_target_is_parsed_by_name_and_anything_else_is_an_error() {
        assert_eq!(Target::parse("current-year").unwrap(), Target::CurrentYear);
        assert_eq!(Target::parse("all").unwrap(), Target::All);
        assert!(Target::parse("everything").is_err());
    }

    #[test]
    fn january_includes_the_year_that_just_ended() {
        assert_eq!(current_years(day(2027, 1, 3)), vec![2026, 2027]);
        assert_eq!(current_years(day(2026, 10, 7)), vec![2026]);
    }
}
