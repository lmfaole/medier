import { SourceList } from "@lmfaole/designsystem/components/source-list"

/**
 * Where the data comes from, once, at the foot of «Innstillinger» rather than on every page: each source with its mark beside its name
 * (Spotify's is the attribution its developer policy asks for; each Spotify thing also links back to it), what it gives and how fresh
 * it is (`TTL` in `lib/sources.ts`), and the sentence TMDB asks for. A source that did not answer is still said on the page it failed on (`Fetched`).
 */
export function Credits() {
  return (
    <SourceList
      sources={[
        { name: "Last.fm", brand: "lastfm", href: "https://www.last.fm", description: "Det du har spilt og det som spilles nå, hentet på nytt hvert minutt." },
        { name: "Trakt", brand: "trakt", href: "https://trakt.tv", description: "Filmene og episodene du har sett, hentet på nytt hvert femte minutt." },
        { name: "Spotify", brand: "spotify", href: "https://open.spotify.com", description: "Bilder av artister, og lenker til dem på Spotify." },
        { name: "TMDB", brand: "tmdb", href: "https://www.themoviedb.org", description: "Plakater, hvem som er med og fakta om filmer og serier.", credit: "Denne siden bruker TMDB API, men er ikke støttet eller sertifisert av TMDB." },
      ]}
    />
  )
}
