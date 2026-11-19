pub fn normalize_url(url: &str) -> String {
    let mut s = url.trim().to_string();
    // Remove trailing slashes
    while s.ends_with('/') {
        s.pop();
    }
    s
}

/** A human-readable label derived from a feed or episode URL's last path segment, used when
 * podcasts.db has no title for the item (an episode older than its feed keeps, or an
 * unregistered show). Returns None for an empty or bare-domain URL. */
pub fn derive_label_from_url(url: &str) -> Option<String> {
    let last = url.split('/').next_back()?;
    let name = last.split('?').next()?.trim();
    if name.is_empty() || !name.contains('.') {
        // bare domain or trailing slash only, no path segment worth showing
        return None;
    }
    let name = name.trim_end_matches(".xml").trim_end_matches(".mp3").trim_end_matches(".rss").trim_end_matches(".html");
    if name.is_empty() {
        return None;
    }
    Some(name.replace('_', " "))
}

pub fn extract_episode_key(guid: Option<&str>, episode_url: &str) -> String {
    if let Some(g) = guid {
        let g = g.trim();
        if !g.is_empty() {
            // gpoddersync may prefix the guid (eg "l_" for loaded), strip it
            let stripped = g.strip_prefix("l_").unwrap_or(g);
            return stripped.to_string();
        }
    }
    normalize_url(episode_url)
}
