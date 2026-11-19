use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct SeriesMapping {
    pub series_key: String,
    pub series_title: Option<String>,
}

#[derive(Debug, Clone)]
pub struct EpisodeMapping {
    pub episode_title: Option<String>,
}

pub fn find_series_key_by_rss(podcasts_db: &Path, rss_url: &str) -> Result<Option<SeriesMapping>> {
    let conn = Connection::open(podcasts_db)
        .with_context(|| format!("Open podcasts db at {}", podcasts_db.display()))?;
    let rss = rss_url.trim();
    // An exact feed_url match wins; a substring match is the fallback for a feed URL that
    // shifted host or path since the show was registered. `LIMIT 1` keeps the exact row first.
    let mut stmt = conn.prepare(
        "SELECT show_name, title FROM podcast_show_info WHERE feed_url = ?1 \
         UNION ALL \
         SELECT show_name, title FROM podcast_show_info WHERE feed_url LIKE ?2 \
         LIMIT 1"
    ).context("Prepare series lookup")?;
    let mut rows = stmt.query(params![rss, format!("%{rss}%")])
        .context("Query series")?;
    if let Some(row) = rows.next()? {
        let show_name: String = row.get(0)?;
        let title: Option<String> = row.get(1)?;
        return Ok(Some(SeriesMapping { series_key: show_name, series_title: title }));
    }
    Ok(None)
}

pub fn find_series_title_by_name(podcasts_db: &Path, show_name: &str) -> Result<Option<String>> {
    let conn = Connection::open(podcasts_db)
        .with_context(|| format!("Open podcasts db at {}", podcasts_db.display()))?;
    let mut stmt = conn.prepare("SELECT title FROM podcast_show_info WHERE show_name = ?1")
        .context("Prepare title lookup")?;
    let mut rows = stmt.query(params![show_name])
        .context("Query title")?;
    if let Some(row) = rows.next()? {
        let title: Option<String> = row.get(0)?;
        return Ok(title);
    }
    Ok(None)
}

pub fn find_by_guid(podcasts_db: &Path, guid: &str) -> Result<Option<(String, String, Option<String>)>> {
    let conn = Connection::open(podcasts_db)
        .with_context(|| format!("Open podcasts db at {}", podcasts_db.display()))?;
    let mut stmt = conn.prepare(
        "SELECT show_name, guid, title FROM podcast_feed_episode WHERE guid = ?1 LIMIT 1"
    ).context("Prepare guid lookup")?;
    let mut rows = stmt.query(params![guid])
        .context("Query guid")?;
    if let Some(row) = rows.next()? {
        let show_name: String = row.get(0)?;
        let g: String = row.get(1)?;
        let title: Option<String> = row.get(2)?;
        return Ok(Some((show_name, g, title)));
    }
    Ok(None)
}

pub fn find_episode_mapping(podcasts_db: &Path, series_key: &str, episode_url: &str, guid: Option<&str>) -> Result<Option<EpisodeMapping>> {
    let conn = Connection::open(podcasts_db)
        .with_context(|| format!("Open podcasts db at {}", podcasts_db.display()))?;
    let mut stmt = conn.prepare(
        "SELECT title FROM podcast_feed_episode WHERE show_name = ?1 AND (guid = ?2 OR ?2 = '' OR link = ?3) ORDER BY published_at DESC LIMIT 1"
    ).context("Prepare episode lookup")?;
    let g = guid.unwrap_or("");
    let mut rows = stmt.query(params![series_key, g, episode_url])
        .context("Query episode")?;
    if let Some(row) = rows.next()? {
        let episode_title: Option<String> = row.get(0)?;
        return Ok(Some(EpisodeMapping { episode_title }));
    }
    Ok(None)
}

/// The names of the shows `podcasts.db` knows (`podcast_shows`), for putting a feed's title under the right one.
pub fn show_names(podcasts_db: &Path) -> Result<Vec<String>> {
    let conn = Connection::open(podcasts_db).with_context(|| format!("Open podcasts db at {}", podcasts_db.display()))?;
    let mut stmt = conn.prepare("SELECT artist_name FROM podcast_shows").context("Prepare show names")?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0)).context("Query show names")?.collect::<std::result::Result<Vec<_>, _>>().context("Read show names")?;
    Ok(names)
}
