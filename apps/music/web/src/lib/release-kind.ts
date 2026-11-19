// What kind of release a recording is on, from MusicBrainz' primary and secondary types, in Norwegian:
// «Live, Album», «Samling, Album», «Singel».

const PRIMARY: Record<string, string> = { Album: 'Album', Single: 'Singel', EP: 'EP', Broadcast: 'Sending', Other: 'Annet' }
const SECONDARY: Record<string, string> = {
  Live: 'Live',
  Compilation: 'Samling',
  Soundtrack: 'Lydspor',
  Remix: 'Remiks',
  'DJ-mix': 'DJ-miks',
  Mixtape: 'Mixtape',
  Demo: 'Demo',
  Spokenword: 'Talt ord',
  Interview: 'Intervju',
  Audiobook: 'Lydbok',
  Audio: 'Lyd',
}

/** The release's kind as a line, or none where MusicBrainz has no type for it; a type it names that is not here is left out. */
export function releaseKindOf(primary: string | null, secondary: string | null): string | null {
  const parts = [...(secondary?.split(',') ?? []).map((type) => SECONDARY[type.trim()]), primary === null ? undefined : PRIMARY[primary]].filter((part) => part !== undefined)
  return parts.length === 0 ? null : parts.join(', ')
}
