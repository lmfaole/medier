# Bibliotek og oppsummering som valgfri tjeneste

## Mål

Appene skal ikke lenger få statistikk, bibliotek og oppsummering som standard. Statistikk forsvinner. Bibliotek og oppsummering (`/kapsel`) blir en tjeneste en app skrur på, og bare der det gir mening.

## Beslutninger

- **Statistikk slettes helt**: `/statistikk`-sidene i alle åtte apper (music, podkast, film, tv, games, books, boardgames, rss), views, server-kode (`film-stats`, `tv-stats`, `podcast-stats`), API-endepunkter, responses, tester, e2e, OG-oppføringer, lenker og snarveien `g s`.
- **Forsidens `/oppsummering` slettes**: siden, `summary.ts`, API, snapshot-del og tester i `apps/forside`.
- **Bibliotek** (`library`) gis til ting man kan eie: music, film, games, books, boardgames. Podkast og tv mister `/bibliotek`.
- **Oppsummering** (`capsule`, `/kapsel`) beholdes i de sju appene som har den i dag: music, podkast, film, tv, games, books, boardgames. rss og work får den ikke.
- **Utenfor omfanget:** å redesigne kapselinnholdet (år mot i fjor, fun facts, Wrapped-stil). Det er en egen runde etterpå.

## Design

1. **Én fasit.** Hver app i `packages/ui/src/lib/apps.ts` får `features: readonly ("library" | "capsule")[]`.
2. **Utledet fra fasiten:**
   - sidelinkene (`pages`) og snarveiene `g b` og `g k`,
   - oppføringene i `packages/ui/src/lib/og-pages.json`,
   - sidelistene i `e2e/pages.ts`,
   - `STANDARD_ROUTES` i `scripts/media-apps.test.ts`, som i dag krever lik sideliste i alle apper.
3. **Sidene.** `bibliotek.astro` og `kapsel.astro` blir i appene (Astro ruter etter filsystemet). En app har filen bare hvis den har tjenesten. Delt UI ligger fortsatt i `packages/ui`.
4. **Konsistenstest.** En test feiler hvis `features` og sidefilene ikke stemmer overens, i begge retninger.

## Rekkefølge

1. Fjern statistikk.
2. Fjern forsidens `/oppsummering`.
3. Innfør `features`, utled lenker, snarveier, OG og e2e fra den, og lag konsistenstesten.
4. Fjern bibliotek fra podkast og tv.
5. Verifiser med `npm run verify`, og oppdater `AGENTS.md`, `apps/README.md` og berørte `apps/*/AGENTS.md`.

## Risiko og åpne punkter

- Musikks statistikkside leser `summary`-endepunktet (`period: 'all'`), og kapsel bruker sannsynligvis den samme dataen. Før noe slettes sjekkes hva som er delt. Bare det som kun statistikk bruker, slettes.
- Snapshot-filer og `RESPONSES`-skjemaer kan deles mellom statistikk og kapsel, og samme sjekk gjelder dem.
- `db/*.sql` og `crates/shared-data` har ucommittede endringer fra før. Arbeidet må ikke blande dem inn.
