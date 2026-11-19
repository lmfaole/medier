// How a month or a year differs from the one before, in words, for the notifications of `digest.ts`.

/** How the plays differ from the one before, in words (`before`: «måneden før», «uken før»); nothing for one that cannot be compared. */
export function changeSaid(change: number | null, before: string): string {
  if (change === null) return ''
  if (change === 0) return `like mange som ${before}`
  return `${change > 0 ? 'opp' : 'ned'} ${Math.abs(change)} % fra ${before}`
}
