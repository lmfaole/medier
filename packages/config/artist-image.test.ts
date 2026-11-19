import { strict as assert } from "node:assert"
import { test } from "node:test"

import { commonsFilePage, imageCreditOf, imagePathOf } from "./artist-image.ts"

const ADDRESS = "https://commons.wikimedia.org/wiki/Special:FilePath/Bj%C3%B6rk_2015.jpg?width=400"

test("a picture's path and its Commons page come only from addresses this app asks for", () => {
  assert.equal(imagePathOf("87c5dedd-371d-4a53-9f7f-80522fb7f3cb"), "/artists/87c5dedd-371d-4a53-9f7f-80522fb7f3cb.jpg")
  assert.equal(imagePathOf("../../etc/passwd"), null)
  assert.equal(commonsFilePage(ADDRESS), "https://commons.wikimedia.org/wiki/File:Bj%C3%B6rk_2015.jpg")
  assert.equal(commonsFilePage("https://evil.test/wiki/Special:FilePath/x.jpg"), null)
})

test("a picture from Deezer is credited to Deezer, and only Deezer's own image host counts", () => {
  assert.equal(imageCreditOf("https://cdn-images.dzcdn.net/images/artist/ab12/1000x1000-000000-80-0-0.jpg"), "https://www.deezer.com")
  assert.equal(imageCreditOf("https://cdn-images.dzcdn.net.evil.test/images/artist/ab12/x.jpg"), null)
})

test("a picture from Spotify is credited to Spotify, and only its own image host counts", () => {
  assert.equal(imageCreditOf("https://i.scdn.co/image/ab6761610000e5eb9354faf80eb879614"), "https://www.spotify.com")
  assert.equal(imageCreditOf("https://i.scdn.co.evil.test/image/ab12"), null)
})
