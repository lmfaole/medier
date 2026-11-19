/**
 * The register names genres and countries in English, so they are put into Norwegian where the pages are
 * built; a name this does not know is shown as the register gave it.
 */

import { countryName } from '@designsystem/intl/listening'

/** TMDB's genres for films and for series, which have a few names of their own («Sci-Fi & Fantasy»). */
const GENRES: Readonly<Record<string, string>> = {
  Action: 'Action',
  Adventure: 'Eventyr',
  Animation: 'Animasjon',
  Comedy: 'Komedie',
  Crime: 'Krim',
  Documentary: 'Dokumentar',
  Drama: 'Drama',
  Family: 'Familie',
  Fantasy: 'Fantasy',
  History: 'Historie',
  Horror: 'Skrekk',
  Music: 'Musikk',
  Mystery: 'Mysterium',
  Romance: 'Romantikk',
  'Science Fiction': 'Science fiction',
  'TV Movie': 'TV-film',
  Thriller: 'Thriller',
  War: 'Krig',
  Western: 'Western',
  'Action & Adventure': 'Action og eventyr',
  Kids: 'Barn',
  News: 'Nyheter',
  Reality: 'Reality',
  'Sci-Fi & Fantasy': 'Science fiction og fantasy',
  Soap: 'Såpeopera',
  Talk: 'Prat',
  'War & Politics': 'Krig og politikk',
}

export function genreName(name: string): string {
  return GENRES[name] ?? name
}

let codesByEnglishName: Map<string, string> | undefined

/** TMDB's `production_countries` carry only an English name; the code behind it is found by asking the platform for every region's. */
function regionCodes(): Map<string, string> {
  if (codesByEnglishName === undefined) {
    const english = new Intl.DisplayNames(['en'], { type: 'region' })
    const codes = new Map<string, string>()
    for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const code = first + second
        const name = english.of(code)
        if (name !== undefined && name !== code) codes.set(name, code)
      }
    }
    codes.set('United States of America', 'US')
    codesByEnglishName = codes
  }
  return codesByEnglishName
}

export function productionCountryName(name: string): string {
  const code = regionCodes().get(name)
  return code === undefined ? name : countryName(code)
}

const LANGUAGES = new Intl.DisplayNames('nb-NO', { type: 'language' })

/** A language spoken in a title by its ISO 639-1 code, in Norwegian where the platform knows it and else as the register wrote it. */
export function spokenLanguageName(code: string, registerName: string): string {
  try {
    const name = LANGUAGES.of(code)
    return name === undefined || name === code ? registerName : name.charAt(0).toLocaleUpperCase('nb-NO') + name.slice(1)
  } catch {
    return registerName
  }
}
