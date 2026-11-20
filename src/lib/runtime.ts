/**
 * The Worker's end of `sources.ts`: its settings, and the `get` that asks a source, through the relay, and keeps the answer in the Worker's cache for as long
 * as the source's `ttl` says. A page imports the loaders below, which pass the one to the other; nothing else here is the page's business.
 */

import { env } from "cloudflare:workers"

import { type Env, type Get, type Listening, loadAlbum, loadArtist, loadArtistPictures, loadMusic, loadNowPlaying, loadPerson, loadTrack, loadWatched, settle } from "./sources.ts"
import type { NowPlaying } from "./spotify.ts"
import type { Watched } from "./trakt.ts"

const AGENT = "lmfaole-medier (https://github.com/lmfaole/medier)"
/** A cache key is an address; an answer that is kept under a name (a token) gets one that no one can ask the Worker for. */
const KEY_HOST = "https://cache.medier.invalid/"

/** The settings that are text: a secret or a variable that is not a string (a binding) is not one of ours. */
export const settings = (): Env => Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))

/**
 * Workers on this zone cannot reach an origin outside Cloudflare (every such fetch ends in 525), while a Worker on workers.dev can: the relay (`upstream/`) is that
 * one, and asks on the page's behalf, only for the hosts it knows and only with the key the two share. Without a relay (`astro dev`) the source is asked directly.
 */
async function ask(url: string, request: { headers?: Record<string, string>; method?: "GET" | "POST"; body?: string }): Promise<Response> {
  const relay = settings()["UPSTREAM_URL"]
  const key = settings()["UPSTREAM_KEY"]
  const headers = { "User-Agent": AGENT, Accept: "application/json", ...request.headers }
  const init = { method: request.method ?? "GET", ...(request.body === undefined ? {} : { body: request.body }) }
  if (relay !== undefined && key !== undefined) {
    const target = new URL(url)
    return fetch(`${relay.replace(/\/$/, "")}/${target.host}${target.pathname}${target.search}`, { ...init, headers: { ...headers, "X-Upstream-Key": key } })
  }
  return fetch(url, { ...init, headers })
}

export const get: Get = async (url, request) => {
  const cache = caches.default
  const kept = new Request(request.key === undefined ? url : `${KEY_HOST}${encodeURIComponent(request.key)}`)
  const found = await cache.match(kept)
  if (found !== undefined) return { data: await found.json(), hit: true }
  const response = await ask(url, request)
  if (!response.ok) throw new Error(`${new URL(url).host}: ${response.status}`)
  // 204 is «nothing» (nothing is playing): kept as that, so a quiet moment is not asked about again for its whole length either.
  const data: unknown = response.status === 204 ? null : await response.json()
  await cache.put(kept, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${request.ttl}` } }))
  return { data, hit: false }
}

/** Each source on its own, `null` when it is not set up or is down: a page shows what it has. */
export const music = (): Promise<Listening | null> => settle(loadMusic(settings(), get))
export const watched = (): Promise<Watched | null> => settle(loadWatched(settings(), get))
export const spotifyNow = (): Promise<NowPlaying | null> => settle(loadNowPlaying(settings(), get))
export const artist = (name: string) => loadArtist(settings(), get, name)
export const artistPictures = (names: readonly string[]) => loadArtistPictures(settings(), get, names)
export const person = (id: number) => settle(loadPerson(settings(), get, id))
export const album = (artist: string, title: string) => loadAlbum(settings(), get, artist, title)
export const track = (artist: string, title: string) => loadTrack(settings(), get, artist, title)
