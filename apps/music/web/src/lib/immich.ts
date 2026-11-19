/** Where the owner's photos are, as the browser reaches them. An album is private to its owner, so the link is for the owner only. */
const IMMICH_ALBUM = 'https://bilder.lmfaole.party/albums/'

export const albumHref = (albumId: string): string => `${IMMICH_ALBUM}${albumId}`
