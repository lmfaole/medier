//! Entry point: one job per run, so a schedule only does the work its data
//! needs. New listens and their metadata, the recent years' tables, the rolling
//! windows and the all-time count and streaks run daily; "all time" runs weekly.
//! Run by hand from `apps/music` (`MUSIC_DB` names the database file; the default is `.data/music.db`).

mod aggregate;
mod variants;
mod album_key;
mod artist_relations;
mod artist_alias;
mod album_tracklist;
mod album_types;
mod album_tracks;
mod capsules;
mod collab;
mod concert_calendar;
mod concert_photos;
mod concerts;
mod cover_colors;
mod setlist;
mod credits;
mod daily;
mod deezer;
mod discogs;
mod entities;
mod entity_albums;
mod entity_artists;
mod entity_songs;
mod apple;
mod apple_podcasts;
mod enrich;
mod musicbrainz_extra;
mod release_covers;
mod release_dates;
mod feedback;
mod first_page;
mod collection;
mod heard;
mod lastfm;
mod lastfm_estimated;
mod lastfm_love;
mod likes;
mod listenbrainz;
mod memories;
mod models;
mod podcast_countries;
mod podcast_feeds;
mod podcasts;
mod names;
mod resolve;
mod resolve_albums;
mod schema;
mod scope;
mod slug;
mod song_key;
mod spotify;
mod spotify_api;
mod spotify_album_images;
mod spotify_images;
mod spotify_library;
mod spotify_recent;
mod spotify_likes;
mod sync;
mod twins;

use anyhow::Context;
use shared_data::app_db::{open_migrated, path_from_env};
use shared_data::job::{run_jobs, Job};
use shared_data::sqlite_client::SqliteClient;
use shared_data::window::Target;

/// Recordings to fetch metadata for per run. At 50 per request and the
/// rate limit's 30 requests per 10 s window, this is well under a minute of
/// requests, leaving the scheduled job's 10-minute limit for everything else.
const MAX_RECORDINGS_ENRICHED_PER_SYNC: usize = 3000;

const TARGETS: &str = "target: current-year | rolling | years | all";

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();

    let jobs = [
        Job::new("listens", "fetch new ListenBrainz listens into the local database", |db: &SqliteClient, _| fetch_listens(db)),
        Job::new("sync-lastfm", "land the Last.fm scrobbles since the newest stored listen (a day back, for overlap) and add the new ones", |db, _| sync_lastfm(db)),
        spotify::job(),
        apple::job(),
        apple_podcasts::job(),
        Job::new("split-podcasts", "move podcast plays out of listens into podcasts.db", |data, _| {
            let path = path_from_env("PODCAST_DB", "../../.data/podcasts.db");
            let podcasts = open_migrated(&path, podcasts::SCHEMA, "podcasts").context("opening the podcasts database")?;
            podcasts::run(data, &podcasts)
        }),
        Job::new("podcast-feeds", "find each show with a few plays in Apple's directory, land its feed under .data/raw/podcast-feeds and store what the feed says (--refresh: every show, again)", |_, args| {
            let path = path_from_env("PODCAST_DB", "../../.data/podcasts.db");
            let podcasts = open_migrated(&path, podcasts::SCHEMA, "podcasts").context("opening the podcasts database")?;
            podcast_feeds::run(&podcasts, args.flag("--refresh"))
        })
        .flags(&["--refresh"]),
        Job::new("podcast-countries", "find where each show with a few plays and no country is made, from Wikidata, landing the answers under .data/raw/wikidata", |_, _| {
            let path = path_from_env("PODCAST_DB", "../../.data/podcasts.db");
            let podcasts = open_migrated(&path, podcasts::SCHEMA, "podcasts").context("opening the podcasts database")?;
            podcast_countries::run(&podcasts)
        }),
        Job::new("add-heard", "add what was heard that no one scrobbled: <kind: artist|album|song> <artist> <title> [year] [day] («-» for none)", |db, args| {
            let optional = |index: usize| Some(args.positional(index)).filter(|value| !value.is_empty() && *value != "-");
            let year = optional(3).map(|value| value.parse::<i64>().with_context(|| format!("«{value}» is not a year"))).transpose()?;
            let new = heard::add(db, args.positional(0), args.positional(1), args.positional(2), year, optional(4))?;
            println!("{}", if new { "added" } else { "already there" });
            Ok(())
        })
        .takes(&["kind", "artist", "title", "year", "day"]),
        Job::new("import-collection", "make the collection exactly the lines of music-collection.csv", |db, _| {
            let path = path_from_env("MUSIC_COLLECTION", "../../.data/music-collection.csv");
            println!("import-collection: {} lines", collection::COLLECTION.import(db, &path)?);
            discogs::overlay(db).map(|_| ())
        }),
        Job::new("discogs", "land the Discogs collection and wantlist of DISCOGS_USER, store them and add them to the collection", |db, _| discogs::pull(db)),
        Job::new("enrich-heard", "ask MusicBrainz for the number, the first release year and the genres of what was heard and not yet looked up", |db, _| {
            println!("enrich-heard: {} found", heard::enrich(db)?);
            Ok(())
        }),
        Job::new("feedback", "replace the loved tracks with what Last.fm says now", |db, _| feedback::sync(db)),
        Job::new("fetch-lastfm", "land every page of the Last.fm scrobbles of LASTFM_USER under .data/raw/lastfm/<today>", |_, _| {
            let directory = shared_data::raw::landing_path("lastfm", chrono::Utc::now().date_naive())?;
            // An interrupted pull is resumed in its own folder; `fetch` starts after the pages it already holds.
            std::fs::create_dir_all(&directory).with_context(|| format!("creating {}", directory.display()))?;
            lastfm::fetch(&directory, None)
        }),
        Job::new("import-lastfm", "add the scrobbles of a landed Last.fm folder, skipping those listens already has", |db, args| {
            lastfm::import(db, std::path::Path::new(args.positional(0)), args.flag("--dry-run"))
        })
        .takes(&["dir"])
        .flags(&["--dry-run"]),
        lastfm_estimated::job(),
        Job::new("resolve-musicbrainz", "give ids to unmapped listens by searching MusicBrainz, for at most <limit> artist-track pairs", |db, args| {
            let limit: usize = args.positional(0).parse().context("the limit must be a number")?;
            resolve::resolve_musicbrainz(db, limit)
        })
        .takes(&["limit"]),
        resolve_albums::job(),
        Job::new("resolve-lastfm", "give ids to unmapped listens by asking Last.fm for the track, for at most <limit> artist-track pairs", |db, args| {
            let limit: usize = args.positional(0).parse().context("the limit must be a number")?;
            resolve::resolve_lastfm(db, limit)
        })
        .takes(&["limit"]),
        Job::new("enrich-extra", "ask MusicBrainz and Wikidata for the release kind, label, years active and picture of what was heard, at most <limit> requests", |db, args| musicbrainz_extra::run(db, args.positional(0).parse().context("the limit must be a number")?))
        .takes(&["limit"]),
        Job::new("release-covers", "ask the Cover Art Archive for the front picture of the releases of listens that have none, at most <limit> requests", |db, args| release_covers::run(db, args.positional(0).parse().context("the limit must be a number")?))
        .takes(&["limit"]),
        Job::new("deezer-images", "ask Deezer for the picture of each artist not yet asked, at most <limit> artists", |db, args| deezer::run(db, args.positional(0).parse().context("the limit must be a number")?))
        .takes(&["limit"]),
        Job::new("enrich", "fetch metadata for recordings without any", |db, _| {
            let count = enrich::enrich_new_recordings(db, MAX_RECORDINGS_ENRICHED_PER_SYNC)
                .context("fetching recording metadata from ListenBrainz")?;
            println!("fetched metadata for {count} recordings");
            Ok(())
        }),
        Job::new("daily-plays", "daily_plays from the target's start on", |db, args| {
            daily::recompute_daily_plays(db, Target::parse(args.positional(0))?)
        })
        .takes(&["target"]),
        Job::new("all-time-totals", "the all-time count, minutes, streaks, from daily tables", |db, _| daily::refresh_all_time_totals(db)),
        Job::new("album-tracklists", "ask MusicBrainz for the tracklist of the most played albums that have none, at most <limit> requests", |db, args| {
            let limit: usize = args.positional(0).parse().context("the limit must be a number")?;
            album_tracklist::run(db, limit)
        })
        .takes(&["limit"]),
        Job::new("variants", "make album_variant, artist_variant and song_variant the album, artist and song of every spelling heard, from the keys, .data/music-albums.csv (MUSIC_ALBUMS) and .data/music-artists.csv (MUSIC_ARTISTS)", |db, _| {
            variants::recompute(db, &path_from_env("MUSIC_ALBUMS", "../../.data/music-albums.csv"), &path_from_env("MUSIC_ARTISTS", "../../.data/music-artists.csv"))
        }),
        Job::new("summaries", "summaries, top lists, breakdowns", |db, args| {
            aggregate::recompute(db, Target::parse(args.positional(0))?)
        })
        .takes(&["target"]),
        Job::new("memories", "on-this-day table: what was heard on each calendar day, per year", |db, _| memories::recompute_memories(db).map(|_| ())),
        Job::new("capsules", "a month in review for every month", |db, _| capsules::recompute_capsules(db).map(|_| ())),
        Job::new("entities", "the pages of the most played artists, albums and songs", |db, _| entities::recompute_entities(db).map(|_| ())),
    ].into_iter().chain(concerts::jobs()).chain(setlist::jobs()).chain(cover_colors::jobs()).chain(album_types::jobs()).chain(spotify_likes::jobs()).chain(spotify_library::jobs()).chain(spotify_recent::jobs()).chain([spotify_images::job(), spotify_album_images::job()]).chain(release_dates::jobs()).chain(likes::jobs()).chain(credits::jobs()).collect::<Vec<_>>();

    let open = || open_migrated(&path_from_env("MUSIC_DB", "../../.data/music.db"), schema::SCHEMA, "music");
    run_jobs("music-sync", TARGETS, &jobs, open, &args)
}

/// The walk goes oldest first, so the bookmark is written after every page: a
/// run that times out partway resumes there next time, and a full-history
/// backfill gets further with each run instead of restarting.
fn fetch_listens(db: &SqliteClient) -> anyhow::Result<()> {
    let username = std::env::var("LISTENBRAINZ_USERNAME").context("LISTENBRAINZ_USERNAME is not set")?;
    let bookmark = sync::read_bookmark(db)?;
    println!("syncing listens for {username} since {bookmark}");

    let mut total_inserted = 0usize;
    listenbrainz::fetch_new_listens(&username, bookmark, |page, next_bookmark| {
        sync::insert_listens(db, page)?;
        sync::write_bookmark(db, next_bookmark, chrono::Utc::now().timestamp())?;
        total_inserted += page.len();
        println!("inserted {total_inserted} listens so far, bookmark now {next_bookmark}");
        Ok(())
    })
    .context("fetching new listens from ListenBrainz")
}

/// Last.fm is the live source of new listens; the day of overlap is absorbed by the twin check on import.
fn sync_lastfm(db: &SqliteClient) -> anyhow::Result<()> {
    let newest = db.query("SELECT MAX(listened_at) AS newest FROM listens", &[])?.first().and_then(|row| row["newest"].as_i64()).unwrap_or(0);
    let directory = lastfm::fresh_landing("lastfm-recent", chrono::Utc::now().date_naive())?;
    lastfm::fetch(&directory, Some((newest - 86_400).max(0)))?;
    lastfm::import(db, &directory, false)
}
