//! Whether a list that is fetched whole, newest first with its total on the first page (the Spotify likes, the
//! Last.fm loves), can have changed since it was stored, told from that first page alone: one request instead of
//! every page, and nothing landed again when nothing is new.

use std::collections::HashSet;
use std::hash::Hash;

/// The same total, the same entries newer than the page's oldest time, and the page's entries at that time among the
/// stored: entries made in the same second come in the service's own order. `stored_since` is what is stored from the
/// page's oldest time on. An entry added or removed anywhere changes the total or the page.
pub fn unchanged<K: Eq + Hash>(page: &[(K, i64)], total: usize, stored_count: usize, stored_since: &[(K, i64)]) -> bool {
    let Some(oldest) = page.iter().map(|(_, at)| *at).min() else { return false };
    let on_page: HashSet<(&K, i64)> = page.iter().map(|(key, at)| (key, *at)).collect();
    let stored: HashSet<(&K, i64)> = stored_since.iter().map(|(key, at)| (key, *at)).collect();
    total == stored_count && newer_than(&on_page, oldest) == newer_than(&stored, oldest) && on_page.is_subset(&stored)
}

fn newer_than<'a, K: Eq + Hash>(entries: &HashSet<(&'a K, i64)>, time: i64) -> HashSet<(&'a K, i64)> {
    entries.iter().filter(|(_, at)| *at > time).copied().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_page_that_matches_the_stored_newest_and_total_means_nothing_changed() {
        let page = [("t2", 20), ("t1", 10)];
        let stored = [("t1", 10), ("t2", 20), ("t3", 10)];
        assert!(unchanged(&page, 5, 5, &stored), "t3 shares the oldest second and comes after the page in the service's order");
        assert!(!unchanged(&page, 5, 4, &stored), "an entry removed further down changes the total");
        assert!(!unchanged(&page, 5, 5, &[("t1", 10), ("t0", 20)]), "a new entry is not among the stored");
        assert!(!unchanged(&page, 5, 5, &[("t1", 10), ("t2", 20), ("t9", 30)]), "a stored entry newer than the page is gone");
        assert!(!unchanged::<&str>(&[], 0, 0, &[]), "an empty page proves nothing");
    }
}
