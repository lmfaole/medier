import type { ConcertSummary } from './types.ts'

/** Who was seen: the headliners where the concert has them (the support acts are listed on its page, not in its title), else the artists written for it, else the artist its title names, else the title. */
export function concertWho(concert: Pick<ConcertSummary, 'acts' | 'artist' | 'title'>): string {
  const headliners = concert.acts.filter((act) => act.billing === 'headliner')
  const named = headliners.length > 0 ? headliners : concert.acts
  return named.length > 0 ? named.map((act) => act.name).join(' og ') : (concert.artist ?? concert.title)
}

/** A festival is a concert with artists written for it and none of them billed as a headliner or a support act: a night is «artist, venue», a festival is its own name and year. */
export function isFestival(concert: Pick<ConcertSummary, 'acts'>): boolean {
  return concert.acts.length > 0 && concert.acts.every((act) => act.billing === null)
}

/** A concert's title in the list and on its page: «artist, venue», or a festival's name and year as the title has it. */
export function concertLabel(concert: Pick<ConcertSummary, 'acts' | 'artist' | 'title' | 'venue'>): string {
  if (isFestival(concert)) return concert.title
  const who = concertWho(concert)
  return concert.venue === null ? who : `${who}, ${concert.venue}`
}

/** The name of the concert's album in Immich: «Festival: name and year» for a festival, else «Konsert: artist, venue, year» as the list shows it. */
export function concertAlbumName(concert: Pick<ConcertSummary, 'acts' | 'artist' | 'title' | 'venue' | 'on'>): string {
  return isFestival(concert) ? `Festival: ${concert.title}` : `Konsert: ${concertLabel(concert)}, ${concert.on.slice(0, 4)}`
}

/** The act of the concert that is `name` (case aside), when the owner wrote it for the concert: a headliner, a support act or an artist of a festival. */
export function actOf(concert: Pick<ConcertSummary, 'acts'>, name: string): ConcertSummary['acts'][number] | undefined {
  return concert.acts.find((act) => act.name.toLowerCase() === name.toLowerCase())
}

/** Whether the artist `name` was at the concert: written for it in any billing, or the artist its title names. */
export function playedAt(concert: Pick<ConcertSummary, 'acts' | 'artist'>, name: string): boolean {
  return concert.artist === name || actOf(concert, name) !== undefined
}
