import { DurationBars } from "@lmfaole/designsystem/components/duration-bars"
import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { Text } from "@lmfaole/designsystem/components/text"
import { Timeline } from "@lmfaole/designsystem/components/timeline"

import type { Play } from "../lib/lastfm.ts"
import type { Playing } from "../lib/now.ts"
import { titleHref, titlePages, trackHref } from "../lib/pages.ts"
import { groupNounsOf, listeningSessions, playingEvent, playsTimeline, spansWithin, watchesTimeline, watchSessions } from "../lib/timeline.ts"
import type { Watch } from "../lib/trakt.ts"
import { mediumHref } from "../lib/media.ts"
import type { Medium } from "../lib/week-source.ts"

/** How far back the sessions go: two days, so last evening is there in the morning. */
const SESSION_HOURS = 48

/** The sessions of the last two days, on a time axis that ends now: listening (from the plays) or watching (from the viewings of films, or of episodes), as `medium` says. */
export function Sessions({ medium, plays = [], watches = [], now, playing = null }: { medium: Medium; plays?: readonly Play[]; watches?: readonly Watch[]; now: string; playing?: Playing | null }) {
  const start = new Date(Date.parse(now) - SESSION_HOURS * 3_600_000).toISOString()
  const music = medium === "music"
  const spans = spansWithin([...listeningSessions(plays, playing === null ? {} : { playingAt: now }), ...watchSessions(watches, { row: medium === "tv" ? "TV" : "Film" })], start, now)
  if (spans.length === 0) return <Text tone="muted">{music ? "Ingen lytteøkter de siste to døgnene." : "Ingen titteøkter de siste to døgnene."}</Text>
  return <DurationBars label={music ? "Lytteøkter de siste to døgnene" : "Titteøkter de siste to døgnene"} spans={spans} now={now} start={start} end={now} />
}

/**
 * The plays (`medium` music) or the viewings (film, tv: the page passes only its own) on a timeline, newest first, under a heading for each day; a run of one album's songs or one show's episodes folds away. A song links to its page
 * here and a viewing to the film's or the show's; the song playing now is first, marked as going on.
 */
export function HistoryTimeline({ medium, plays = [], watches = [], now, playing = null, base }: { medium: Medium; plays?: readonly Play[]; watches?: readonly Watch[]; now: string; playing?: Playing | null; base: string }) {
  const pageOf = new Map(titlePages(watches).flatMap((page) => page.viewings.map((watch) => [watch.id, titleHref(base, page.slug, page.kind)] as const)))
  const events =
    medium === "music"
      ? [...(playing === null ? [] : [playingEvent(playing, now)]), ...playsTimeline(plays, { href: (play) => trackHref(base, play.artist, play.track) })]
      : watchesTimeline(watches, { href: (watch) => pageOf.get(watch.id) })
  if (events.length === 0) {
    const back = `${base}innstillinger/?tilbake=${encodeURIComponent(mediumHref(base, medium, "historikk/"))}`
    return medium === "music" ? (
      <EmptyState icon="history" title="Ingen avspillinger ennå" description="Tidslinjen fylles med det Last.fm fører opp at du hører på. Er den tom, kan det være feil brukernavn, eller at Last.fm ikke svarte akkurat nå." action={{ href: back, label: "Sjekk brukernavnet" }} />
    ) : (
      <EmptyState icon="history" title={medium === "film" ? "Ingen filmer sett ennå" : "Ingen episoder sett ennå"} description="Tidslinjen fylles med det du markerer som sett på Trakt. Er den tom, kan det være feil brukernavn, en privat profil, eller at Trakt ikke svarte akkurat nå." action={{ href: back, label: "Sjekk brukernavnet" }} />
    )
  }
  return <Timeline label={medium === "music" ? "Lyttehistorikk" : "Seerhistorikk"} events={events} now={now} groupNouns={groupNounsOf(events)} />
}
