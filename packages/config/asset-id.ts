/**
 * The id of a stored picture and the name it has in the bucket and in a path.
 * An asset id is `image-<hash>-<width>x<height>-<extension>` (the form the
 * content tables hold); the file name is `<hash>-<width>x<height>.<extension>`,
 * which is also how the Workers' own paths name it
 * (`/og/<hash>-<width>x<height>.<extension>`).
 */

const ASSET_ID = /^image-([0-9a-f]{40})-(\d+x\d+)-([a-z]+)$/
const FILE_NAME = /^([0-9a-f]{40}-\d+x\d+)\.([a-z]+)$/

/** The file name a Worker path uses for an asset id (`<hash>-<w>x<h>.<ext>`), or `null` for an id of another shape. */
export function fileNameOf(assetId: string): string | null {
  const [, hash, dimensions, extension] = ASSET_ID.exec(assetId) ?? []
  return hash === undefined || dimensions === undefined || extension === undefined ? null : `${hash}-${dimensions}.${extension}`
}

/** The asset id of a Worker path's file name: the inverse of `fileNameOf`, `null` for a name of another shape. */
export function assetIdOf(fileName: string): string | null {
  const [, stem, extension] = FILE_NAME.exec(fileName) ?? []
  if (stem === undefined || extension === undefined) return null
  return `image-${stem.slice(0, 40)}-${stem.slice(41)}-${extension}`
}
