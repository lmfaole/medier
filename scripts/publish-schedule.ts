/**
 * When each app on Cloudflare is published, and which syncs' runs its data comes from (`publish-timers.ts` runs it,
 * `timers-check.ts` compares it with what systemd has). Only `forside` and `work` are published: the eight media apps are
 * served live by the `media` server (`docs/MEDIA-SERVER.md`) and have no snapshot to publish. A publication follows the app's
 * syncs; the timer is the fallback: a finished sync also starts the publication (`publishersOf`).
 */

export interface Publishing {
  sources: string[]
  /** For a source named here only these jobs hold the publication back; the others (enrichment, summaries) are not what the snapshot shows. */
  jobs?: Record<string, string[]>
  /** For a source named here these jobs (by name) never hold the publication back: what only adds context to the data, so a lapsed sign-in must not stop the snapshot. */
  ignoring?: Record<string, string[]>
  /** A systemd `OnCalendar` expression. */
  calendar: string
}

export const PUBLISHING: Record<string, Publishing> = {
  work: { sources: ["work"], calendar: "*-*-* 04:20:00" },
  // The front page of the media apps shows the latest of six of them, so it follows their syncs. Of music it
  // needs only the plays and watches, so a slow or killed enrichment job (TMDB refresh, MusicBrainz) does not keep the log from its newest entries.
  forside: { sources: ["music", "film", "tv", "games", "books", "boardgames"], jobs: {
      music: ["sync-lastfm", "split-podcasts"],
      film: ["trakt", "import-log", "import-calendar", "import-cinemas"],
      tv: ["trakt", "import-log"],
    }, calendar: "*-*-* 00/3:55:00" },
}

/** The apps whose publication reads the data of `source`: they are started when its sync has run, instead of waiting for their timer. */
export function publishersOf(source: string): string[] {
  return Object.entries(PUBLISHING).filter(([, publishing]) => publishing.sources.includes(source)).map(([app]) => app)
}
