import { strict as assert } from "node:assert"
import { test } from "node:test"

import { AI_AND_SEO_CRAWLERS, BLOCKED_CRAWLERS, INDEXABLE_HEADERS, CACHE_API, CACHE_IMMUTABLE, CACHE_STANDARD, DEV_SECURITY_HEADERS, SECURITY_HEADERS, cacheControlFor, isImmutablePath, withConnectSource, withFrameSource } from "./security-headers.ts"

test("cacheControlFor picks the API, immutable and revalidating rules by path", () => {
  assert.equal(cacheControlFor("/api/periods.json"), CACHE_API)
  assert.equal(cacheControlFor("/assets/index-abc123.js"), CACHE_IMMUTABLE)
  assert.equal(cacheControlFor("/_astro/Library.Cx9fA1.js"), CACHE_IMMUTABLE)
  assert.equal(cacheControlFor("/"), CACHE_STANDARD)
  assert.equal(cacheControlFor("/apiary"), CACHE_STANDARD)
})

test("an album cover and a film poster are immutable content, like an image under /media/", () => {
  assert.equal(cacheControlFor("/posters/aB3.jpg"), CACHE_IMMUTABLE)
  assert.equal(cacheControlFor("/covers/f1418001-7f1e-46af-bfdb-95faeded8841/1-250.jpg"), CACHE_IMMUTABLE)
})

test("an image under /media/ is immutable content, like a hashed asset", () => {
  assert.equal(cacheControlFor("/media/spill-2018/Stortinget/images/wheel.jpg"), CACHE_IMMUTABLE)
  assert.equal(isImmutablePath("/media/spill-2018/Stortinget/images/wheel.jpg"), true)
  assert.equal(isImmutablePath("/media/wayback/2026-06-07-favicon.svg"), true)
  assert.equal(isImmutablePath("/og/0123abcd-1200x630.jpg"), true)
  // A path that merely starts with the same letters is a page, not content.
  assert.equal(isImmutablePath("/mediaark"), false)
})

test("the CSP allows images from this origin only, since apps proxy any others", () => {
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /img-src 'self' data:;/)
})

test("the CSP lets the page load its own manifest and no other", () => {
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /manifest-src 'self';/)
})

test("the dev headers allow inline scripts and blob workers and are the production headers otherwise", () => {
  const devCsp = DEV_SECURITY_HEADERS["Content-Security-Policy"]
  assert.match(devCsp, /script-src 'self' 'unsafe-inline'/)
  assert.match(devCsp, /worker-src blob:$/)
  assert.ok(!SECURITY_HEADERS["Content-Security-Policy"].includes("worker-src"))
  assert.equal(
    devCsp.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'").replace("; worker-src blob:", ""),
    SECURITY_HEADERS["Content-Security-Policy"],
  )
  assert.deepEqual(
    { ...DEV_SECURITY_HEADERS, "Content-Security-Policy": "" },
    { ...SECURITY_HEADERS, "Content-Security-Policy": "" },
  )
})

test("withFrameSource adds one frame origin and changes nothing else", () => {
  const widened = withFrameSource(SECURITY_HEADERS, "https://embed.example.test")
  assert.equal(widened["Content-Security-Policy"], `${SECURITY_HEADERS["Content-Security-Policy"]}; frame-src https://embed.example.test`)
  assert.equal(widened["X-Frame-Options"], SECURITY_HEADERS["X-Frame-Options"])
  assert.ok(!SECURITY_HEADERS["Content-Security-Policy"].includes("frame-src"))
})

test("withConnectSource lets the page call the given origins and changes nothing else", () => {
  const widened = withConnectSource(SECURITY_HEADERS, "https://api.one.test", "https://api.two.test")
  assert.match(widened["Content-Security-Policy"], /connect-src 'self' https:\/\/api\.one\.test https:\/\/api\.two\.test;/)
  assert.equal(widened["Content-Security-Policy"].replace(" https://api.one.test https://api.two.test", ""), SECURITY_HEADERS["Content-Security-Policy"])
  assert.equal(widened["X-Frame-Options"], SECURITY_HEADERS["X-Frame-Options"])
  assert.ok(!SECURITY_HEADERS["Content-Security-Policy"].includes("api.one.test"))
})

test("an indexable app carries every header but the robots one", () => {
  const { "X-Robots-Tag": _robots, ...rest } = SECURITY_HEADERS
  assert.deepEqual(INDEXABLE_HEADERS, rest)
  assert.ok(!("X-Robots-Tag" in INDEXABLE_HEADERS))
})

test("the crawlers an indexable app still refuses are the AI and SEO ones, never a search engine", () => {
  for (const searchEngine of ["Googlebot", "Bingbot", "DuckDuckBot", "Applebot"]) {
    assert.ok(BLOCKED_CRAWLERS.includes(searchEngine), `${searchEngine} stays blocked for the personal apps`)
    assert.ok(!AI_AND_SEO_CRAWLERS.includes(searchEngine), `${searchEngine} may index an indexable app`)
  }
  for (const other of ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "AhrefsBot"]) assert.ok(AI_AND_SEO_CRAWLERS.includes(other), other)
})
