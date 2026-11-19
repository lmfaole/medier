// What TMDB asks of whoever shows its data: to say so, and that it does not stand behind the page.

export function TmdbNotice() {
  return (
    <p className="text-xs text-muted-foreground">
      Plakater, beskrivelser og folk fra{' '}
      <a href="https://www.themoviedb.org" rel="noopener noreferrer" className="underline underline-offset-4">
        TMDB
      </a>
      . Siden bruker TMDBs API, men er ikke godkjent eller sertifisert av TMDB.
    </p>
  )
}
