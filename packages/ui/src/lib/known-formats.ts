// The format names the pages have a word or a logo for: what `formatLabel` and `platformOf` know. A name outside it still
// shows (with a capital, or as text), so this is the list a report checks the data against, not a gate.

import { FORMAT_LABELS } from './ownership.ts'
import { PLATFORM_FORMATS } from './platforms.ts'

export const KNOWN_FORMATS: ReadonlySet<string> = new Set([...Object.keys(FORMAT_LABELS), ...PLATFORM_FORMATS])
