// The platform a collection format names (`playstation`, `xbox one`, `gba`), for the page to show as a logo or a name.
// The format is free text written by hand or by a sync (`ownership.ts`): a name this does not know is not a platform.

export type Brand = 'steam' | 'playstation' | 'xbox' | 'windows'

/** The brand a format belongs to: every PlayStation and Xbox generation is its brand's logo. */
const BRANDS: Readonly<Record<string, Brand>> = {
  steam: 'steam',
  playstation: 'playstation',
  psx: 'playstation',
  ps2: 'playstation',
  ps3: 'playstation',
  ps4: 'playstation',
  ps5: 'playstation',
  psp: 'playstation',
  vita: 'playstation',
  xbox: 'xbox',
  'xbox one': 'xbox',
  'xbox 360': 'xbox',
  'xbox series': 'xbox',
  windows: 'windows',
  pc: 'windows',
}

/** Systems with no logo here (the makers' marks are not free to draw): one generic icon for them all, each named on hover. */
const CONSOLES: Readonly<Record<string, string>> = {
  nes: 'NES',
  snes: 'SNES',
  n64: 'Nintendo 64',
  ngc: 'GameCube',
  wii: 'Wii',
  switch: 'Switch',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  gba: 'Game Boy Advance',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
}

/** Every format name that is a platform here, with a logo or a name. */
export const PLATFORM_FORMATS: readonly string[] = [...Object.keys(BRANDS), ...Object.keys(CONSOLES)]

export type Platform = { kind: 'brand'; brand: Brand } | { kind: 'other'; name: string }

/** What a single format name is as a platform, or none (`digital`, `cd`, `fysisk`). */
export function platformOf(format: string): Platform | null {
  const name = format.trim().toLowerCase()
  const brand = BRANDS[name]
  if (brand !== undefined) return { kind: 'brand', brand }
  const console = CONSOLES[name]
  return console === undefined ? null : { kind: 'other', name: console }
}
