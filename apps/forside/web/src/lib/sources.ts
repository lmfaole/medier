// Where the media apps' content comes from and when it is fetched: the one list the `/kilder` page is written from. A service is named once per app that uses it, because what it gives
// differs from app to app.
import type { AppId } from '@designsystem/ui/lib/apps'

import { daily, everyThreeHours, weekly, type Schedule } from './next-sync.ts'

/** `api`: fetched from the service's own API; `export`: the service's own export, landed by hand; `register`: a public register that says what each thing is. */
export type SourceKind = 'api' | 'export' | 'register'

export interface Source {
  label: string
  /** The service's own site, or none when there is no site to link. */
  href: string | null
  kind: SourceKind
  note: string
  /** How often it is fetched, in words. */
  when: string
  /** The timer's times, or none when it is fetched only when I ask for it. */
  schedule: Schedule | null
}

export const KIND_LABELS: Record<SourceKind, string> = {
  api: 'Hentet fra API',
  export: 'Fra eksport',
  register: 'Register',
}


/** My accounts at the services, as public as the profile pages they lead to (Steam's has to be public for the game details to be read). */
export const ACCOUNTS: readonly { service: string; name: string; href: string; used: string }[] = [
  { service: 'Trakt', name: 'lmfaole', href: 'https://trakt.tv/users/lmfaole', used: 'film og tv' },
  { service: 'Last.fm', name: 'snowpony69', href: 'https://www.last.fm/user/snowpony69', used: 'musikk og podkast' },
  { service: 'ListenBrainz', name: 'lmfaole', href: 'https://listenbrainz.org/user/lmfaole/', used: 'musikk og podkast' },
  { service: 'Spotify', name: 'lmfaole', href: 'https://open.spotify.com/user/lmfaole', used: 'musikk og podkast, fra eksporten' },
  { service: 'Hardcover', name: 'lmfaole', href: 'https://hardcover.app/@lmfaole', used: 'bøker' },
  { service: 'Steam', name: '76561198871653749', href: 'https://steamcommunity.com/profiles/76561198871653749', used: 'spill' },
  { service: 'RetroAchievements', name: 'lmfaole2', href: 'https://retroachievements.org/user/lmfaole2', used: 'spill' },
]

/** The apps in the order `/kilder` lists them, each with what it is fed from. */
export const SOURCES: readonly { app: Extract<AppId, 'music' | 'podkast' | 'film' | 'tv' | 'games' | 'books' | 'boardgames'>; sources: readonly Source[] }[] = [
  {
    app: 'music',
    sources: [
      { label: 'Last.fm', href: 'https://www.last.fm', kind: 'api', note: 'musikken jeg har spilt, scrobble for scrobble', when: 'hver tredje time', schedule: everyThreeHours(17) },
      { label: 'ListenBrainz', href: 'https://listenbrainz.org', kind: 'api', note: 'lyttinger og hvilke låter jeg har likt', when: 'jevnlig', schedule: everyThreeHours(17) },
      { label: 'Spotify', href: 'https://www.spotify.com', kind: 'export', note: 'den lange lyttehistorikken, fra dataeksporten min', when: 'når jeg ber om en ny eksport', schedule: null },
      { label: 'MusicBrainz', href: 'https://musicbrainz.org', kind: 'register', note: 'fakta om artister, album og sjangre', when: 'ukentlig', schedule: weekly(1, 4, 47) },
    ],
  },
  {
    app: 'podkast',
    sources: [
      { label: 'AntennaPod', href: 'https://antennapod.org', kind: 'api', note: 'hver avspilling, pause og ferdig hørt episode, via Nextcloud', when: 'hver tredje time', schedule: everyThreeHours(35) },
      { label: 'Nextcloud', href: 'https://nextcloud.com', kind: 'api', note: 'min egen server, der AntennaPod lagrer historikken', when: 'hver tredje time', schedule: everyThreeHours(35) },
      { label: 'Spotify', href: 'https://www.spotify.com', kind: 'export', note: 'podkaster jeg lyttet til der, fra eksporten', when: 'når jeg ber om en ny eksport', schedule: null },
      { label: 'Last.fm og ListenBrainz', href: null, kind: 'api', note: 'avspillinger som ble scrobblet', when: 'hver tredje time', schedule: everyThreeHours(35) },
    ],
  },
  {
    app: 'film',
    sources: [
      { label: 'Trakt', href: 'https://trakt.tv', kind: 'api', note: 'filmer jeg har sett, begge veier', when: 'jevnlig', schedule: daily(3, 55) },
      { label: 'TMDB', href: 'https://www.themoviedb.org', kind: 'register', note: 'fakta, plakater og besetning', when: 'daglig, alt på nytt hver uke', schedule: daily(3, 55) },
      { label: 'Kalenderen min', href: null, kind: 'export', note: 'kinobesøk, fra kalenderen i Nextcloud', when: 'daglig', schedule: daily(3, 30) },
    ],
  },
  {
    app: 'tv',
    sources: [
      { label: 'Trakt', href: 'https://trakt.tv', kind: 'api', note: 'episoder og serier jeg har sett', when: 'jevnlig', schedule: daily(3, 58) },
      { label: 'TMDB', href: 'https://www.themoviedb.org', kind: 'register', note: 'fakta om serier, sesonger og episoder', when: 'daglig, alt på nytt hver uke', schedule: daily(3, 58) },
    ],
  },
  {
    app: 'games',
    sources: [
      { label: 'Steam', href: 'https://store.steampowered.com', kind: 'api', note: 'biblioteket, spilletid og achievements', when: 'daglig', schedule: daily(4, 15) },
      { label: 'RetroAchievements', href: 'https://retroachievements.org', kind: 'api', note: 'spill i emulator og achievements for dem', when: 'daglig', schedule: daily(4, 15) },
      { label: 'OpenXBL', href: 'https://xbl.io', kind: 'api', note: 'Xbox-achievements, låste og sjeldenhet', when: 'når jeg kjører den', schedule: null },
      { label: 'TrueAchievements', href: 'https://www.trueachievements.com', kind: 'export', note: 'Xbox-spill, spilletid og achievements fra eksporten', when: 'når jeg henter en ny eksport', schedule: null },
      { label: 'Pokémon GO', href: 'https://pokemongo.com', kind: 'export', note: 'hvilke dager jeg åpnet spillet og medaljene mine, fra Niantics dataeksport', when: 'når jeg ber om en ny eksport', schedule: null },
      { label: 'IGDB', href: 'https://www.igdb.com', kind: 'register', note: 'utvikler, år, sjanger, sammendrag og omslag', when: 'daglig, alt på nytt hver uke', schedule: daily(4, 15) },
    ],
  },
  {
    app: 'books',
    sources: [
      { label: 'Hardcover', href: 'https://hardcover.app', kind: 'api', note: 'hyllene mine, vurderinger og sider, begge veier. Hardcover har siste ord', when: 'daglig', schedule: daily(4, 5) },
      { label: 'Goodreads', href: 'https://www.goodreads.com', kind: 'export', note: 'det gamle biblioteket, fra eksportfilen (Goodreads har ikke noe åpent API)', when: 'engang, for hånd', schedule: null },
      { label: 'Open Library', href: 'https://openlibrary.org', kind: 'register', note: 'forfatter, år, emner og omslag', when: 'daglig, alt på nytt hver uke', schedule: daily(4, 5) },
    ],
  },
  {
    app: 'boardgames',
    sources: [
      { label: 'BoardGameGeek', href: 'https://boardgamegeek.com', kind: 'register', note: 'designere, år, kategorier, beskrivelse og omslag', when: 'daglig, alt på nytt hver uke', schedule: daily(4, 25) },
    ],
  },
]
