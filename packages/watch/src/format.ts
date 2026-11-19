/** How the watch-log apps write an episode and the register's job names in Norwegian. */

import type { Episode } from './viewing.ts'

/**
 * «sesong 2, episode 5», or the half of it the log knows; an empty string when it knows neither, and for a film,
 * whose log has no episodes at all.
 */
export function episodeLabel(episode: Episode | null): string {
  if (episode === null) return ''
  const season = episode.season === null ? '' : `sesong ${episode.season}`
  const number = episode.episode === null ? '' : `episode ${episode.episode}`
  return [season, number].filter((part) => part !== '').join(', ')
}

const DEPARTMENTS: Record<string, string> = {
  Acting: 'Skuespill', Directing: 'Regi', Writing: 'Manus', Camera: 'Foto', Sound: 'Lyd og musikk', Editing: 'Klipp', Production: 'Produksjon', Creator: 'Serieskaper',
}

/** The register's department of a person, in Norwegian where it is one of the usual ones. */
export const departmentName = (department: string): string => DEPARTMENTS[department] ?? department

const CREW_LABELS: Record<string, string> = {
  Director: 'Regi', Creator: 'Serieskaper', Writer: 'Manus', Screenplay: 'Manus', Cinematography: 'Foto', Composer: 'Musikk', Editor: 'Klipp', Producer: 'Produsent', 'Executive Producer': 'Produsent',
}

/** «Writer» → «Manus». */
export const crewLabel = (job: string): string => CREW_LABELS[job] ?? job

/** A cinema ticket's seat as the log writes it («Sal 1, rad 10, sete 7», or «Sal 3, 2 billetter» where no seat was given), taken apart; `null` for a text in neither shape. */
export interface SeatParts {
  hall: string
  /** `null` where the ticket had no assigned seat. */
  row: string | null
  seats: string | null
  /** One ticket per seat, so this is how many came along (the owner included). */
  tickets: number
}

export function seatParts(seat: string): SeatParts | null {
  const seated = /^(.*?), rad (.+?), sete (.+)$/.exec(seat)
  if (seated !== null) {
    const [, hall = '', row = '', seats = ''] = seated
    return { hall, row, seats, tickets: seats.split(',').length }
  }
  const counted = /^(.*?), (\d+) billett(?:er)?$/.exec(seat)
  return counted === null ? null : { hall: counted[1] ?? '', row: null, seats: null, tickets: Number(counted[2]) }
}

/** «Alene» for one ticket, else «Sammen med N andre»: a ticket per person, so more than one means others came along. */
export const companyLabel = (tickets: number): string => (tickets <= 1 ? 'Alene' : `Sammen med ${tickets - 1} ${tickets === 2 ? 'annen' : 'andre'}`)
