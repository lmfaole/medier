// How the register writes a count of players, as the page writes it.

/** The register writes `4` and `3-4`; the page writes the dash it uses elsewhere. */
export const dashed = (counts: string | null) => counts?.replaceAll('-', '–') ?? null
