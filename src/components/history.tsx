import { DurationBars } from "@lmfaole/designsystem/components/duration-bars"
import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text } from "@lmfaole/designsystem/components/text"
import { Timeline } from "@lmfaole/designsystem/components/timeline"

import type { Play } from "../lib/lastfm.ts"
import type { Playing } from "../lib/now.ts"
import { titleHref, titlePages, trackHref } from "../lib/pages.ts"
import { groupNounsOf, listeningSessions, playingEvent, playsTimeline, spansWithin, watchesTimeline, watchSessions } from "../lib/timeline.ts"
import type { Watch } from "../lib/trakt.ts"
import { FromSpotify } from "./credits.tsx"

/** How far back the sessions go: two days, so last evening is there in the morning. */
const SESSION_HOURS = 48

/** The sessions of listening and watching of the last two days, a lane for each, on one time axis that ends now. */
export function Sessions({ plays, watches, now, playing }: { plays: readonly Play[]; watches: readonly Watch[]; now: string; playing: Playing | null }) {
  const start = new Date(Date.parse(now) - SESSION_HOURS * 3_600_000).toISOString()
  const spans = spansWithin([...listeningSessions(plays, playing === null ? {} : { playingAt: now }), ...watchSessions(watches)], start, now)
  if (spans.length === 0) return <Text tone="muted">Ingen lytte- eller titteøkter de siste to døgnene.</Text>
  return <DurationBars label="Lytte- og titteøkter de siste to døgnene" spans={spans} now={now} start={start} end={now} />
}

/**
 * Every play and viewing on one timeline, newest first, under a heading for each day; a run of one album's songs or one show's episodes folds away. A song links to its page
 * here and a viewing to the film's or the show's; the song playing now is first, marked as going on, and links to Spotify where Spotify says it plays (so it is attributed).
 */
export function HistoryTimeline({ plays, watches, now, playing, base }: { plays: readonly Play[]; watches: readonly Watch[]; now: string; playing: Playing | null; base: string }) {
  const pageOf = new Map(titlePages(watches).flatMap((page) => page.viewings.map((watch) => [watch.id, page.slug] as const)))
  const events = [
    ...(playing === null ? [] : [playingEvent(playing, now, playing.from === "spotify" ? playing.url : undefined)]),
    ...playsTimeline(plays, { href: (play) => trackHref(base, play.artist, play.track) }),
    ...watchesTimeline(watches, { href: (watch) => { const slug = pageOf.get(watch.id); return slug === undefined ? undefined : titleHref(base, slug) } }),
  ]
  if (events.length === 0) return <EmptyState icon="history" title="Ingen historikk å vise" description="Last.fm og Trakt svarte ikke, eller har ingenting ennå." />
  const timeline = <Timeline label="Historikk" events={events} now={now} groupNouns={groupNounsOf(events)} />
  return playing?.from === "spotify" ? (
    <Stack gap="md">
      {timeline}
      <FromSpotify />
    </Stack>
  ) : (
    timeline
  )
}
