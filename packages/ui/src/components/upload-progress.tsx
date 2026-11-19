/** The bar of a file being sent: a fraction from 0 to 1, or without one (`undefined`) a bar that only moves, for a request in flight with no byte count yet. */
export function UploadProgress({ fraction, label }: { fraction: number | undefined; label: string }) {
  return <progress className="h-2 w-full accent-(--app-color)" aria-label={label} max={1} {...(fraction === undefined ? {} : { value: fraction })} />
}
