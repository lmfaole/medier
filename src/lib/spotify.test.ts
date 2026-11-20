import { strict as assert } from "node:assert"
import { test } from "node:test"

import { authorizeUrl, codeRequest, parseNowPlaying, parseRefreshToken, parseToken, refreshRequest, SCOPE, TOKEN_URL } from "./spotify.ts"

const PLAYING = {
  is_playing: true,
  currently_playing_type: "track",
  item: {
    name: "Submit",
    artists: [{ name: "Shygirl" }, { name: "Arca" }],
    album: { name: "SWALLOW!", images: [{ url: "https://i.scdn.co/image/large", width: 640 }, { url: "https://i.scdn.co/image/mid", width: 300 }, { url: "https://i.scdn.co/image/small", width: 64 }] },
    external_urls: { spotify: "https://open.spotify.com/track/abc" },
  },
}

test("the song playing is read with its artists, the smallest cover that is 300 wide, and where to open it", () => {
  assert.deepEqual(parseNowPlaying(PLAYING), { track: "Submit", artist: "Shygirl, Arca", album: "SWALLOW!", image: "https://i.scdn.co/image/mid", url: "https://open.spotify.com/track/abc" })
})

test("nothing is playing for a pause, an episode, an ad, an empty answer or a link that is not Spotify's", () => {
  assert.equal(parseNowPlaying({ ...PLAYING, is_playing: false }), null)
  assert.equal(parseNowPlaying({ ...PLAYING, currently_playing_type: "episode" }), null)
  assert.equal(parseNowPlaying({ ...PLAYING, currently_playing_type: "ad" }), null)
  assert.equal(parseNowPlaying(null), null)
  assert.equal(parseNowPlaying({ ...PLAYING, item: { ...PLAYING.item, external_urls: { spotify: "https://example.com/x" } } }), null)
})

test("a cover that is not there is null, not a broken picture", () => {
  assert.equal(parseNowPlaying({ ...PLAYING, item: { ...PLAYING.item, album: { name: "A", images: [] } } })?.image, null)
})

test("the refresh request signs in with the client and carries the user's token as the grant, in the body", () => {
  const request = refreshRequest("id", "secret", "refresh me")
  assert.equal(request.url, TOKEN_URL)
  assert.equal(request.headers["Authorization"], `Basic ${btoa("id:secret")}`)
  assert.equal(request.body, "grant_type=refresh_token&refresh_token=refresh+me")
})

test("a token that was refused (invalid_grant) gives nothing, and one without a lifetime is good for an hour", () => {
  assert.equal(parseToken({ error: "invalid_grant" }), null)
  assert.deepEqual(parseToken({ access_token: "t" }), { accessToken: "t", expiresIn: 3600 })
  assert.deepEqual(parseToken({ access_token: "t", expires_in: 1800 }), { accessToken: "t", expiresIn: 1800 })
})

test("the sign-in asks for the one permission to see what plays, and carries the state back", () => {
  const url = new URL(authorizeUrl("id", "http://127.0.0.1:8888/callback", "xyz"))
  assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize")
  assert.equal(url.searchParams.get("scope"), SCOPE)
  assert.equal(SCOPE, "user-read-currently-playing")
  assert.equal(url.searchParams.get("state"), "xyz")
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8888/callback")
})

test("the code is swapped for the refresh token, and an answer without one gives nothing", () => {
  const request = codeRequest("id", "secret", "the-code", "http://127.0.0.1:8888/callback")
  assert.equal(request.body, "grant_type=authorization_code&code=the-code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback")
  assert.equal(parseRefreshToken({ access_token: "a", refresh_token: "r" }), "r")
  assert.equal(parseRefreshToken({ access_token: "a" }), null)
})
