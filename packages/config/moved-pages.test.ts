import { strict as assert } from "node:assert"
import { test } from "node:test"

import { MOVED_FILM_PAGES, MOVED_MUSIC_PAGES, MOVED_SHELF_PAGES, MOVED_WATCH_PAGES } from "./moved-pages.ts"
import { SPECS } from "../../scripts/media-registry.ts"

test("film's removed library and franchise pages land on its front page, and keep the watch apps' old addresses", () => {
  assert.equal(MOVED_FILM_PAGES["/bibliotek"], "/")
  assert.equal(MOVED_FILM_PAGES["/franchiser"], "/")
  assert.equal(MOVED_FILM_PAGES["/history"], "/historikk")
  assert.equal(MOVED_FILM_PAGES["/memories"], "/")
  assert.equal(MOVED_FILM_PAGES["/minner"], "/")
})

test("only film redirects them: music keeps its library, and tv and podkast never had one", () => {
  assert.equal(MOVED_MUSIC_PAGES["/bibliotek"], undefined)
  assert.equal(MOVED_WATCH_PAGES["/bibliotek"], undefined)
  assert.equal(SPECS.find((spec) => spec.name === "film")?.moved, MOVED_FILM_PAGES)
  for (const name of ["music", "podkast", "tv"]) assert.equal(SPECS.find((spec) => spec.name === name)?.moved["/bibliotek"], undefined, name)
})

test("the on-this-day page is gone from every app but is answered, old name and new, with the front page; music's own retrospective stays", () => {
  for (const name of ["podkast", "film", "tv"]) {
    const moved = SPECS.find((spec) => spec.name === name)?.moved
    assert.equal(moved?.["/minner"], "/", name)
    assert.equal(moved?.["/memories"], "/", name)
  }
  for (const name of ["games", "books", "boardgames"]) assert.equal(SPECS.find((spec) => spec.name === name)?.moved["/minner"], "/", name)
  assert.equal(MOVED_SHELF_PAGES["/minner"], "/")
  assert.equal(MOVED_MUSIC_PAGES["/minner"], "/tilbakeblikk")
  assert.equal(MOVED_MUSIC_PAGES["/memories"], "/tilbakeblikk")
})
