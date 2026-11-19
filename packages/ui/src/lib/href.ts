import { appUrl } from "./base-url.ts"

/** A path of this app with a query string, as a plain link needs it: under the app's base, parameters in the order given, none left empty. */
export function searchHref(path: string, search: Record<string, string> = {}): string {
  const query = new URLSearchParams(Object.entries(search).filter(([, value]) => value !== "")).toString()
  return query === "" ? appUrl(path) : `${appUrl(path)}?${query}`
}
