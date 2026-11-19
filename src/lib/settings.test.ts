import { strict as assert } from "node:assert"
import { test } from "node:test"

import { missingSecrets, parseEnvFile, plan, SETTINGS } from "./settings.ts"

test("an env file is read as the sync tools write it", () => {
  const values = parseEnvFile('# keys\nLASTFM_API_KEY=abc\nexport TRAKT_USER="lmfaole"\n  \nBROKEN LINE\nEMPTY=\n')
  assert.deepEqual([...values], [["LASTFM_API_KEY", "abc"], ["TRAKT_USER", "lmfaole"], ["EMPTY", ""]])
})

test("push sets what it finds and names what it lacks; nothing else in the files is taken", () => {
  const { set, missing } = plan(SETTINGS, new Map([["LASTFM_API_KEY", "k"], ["SPOTIFY_CLIENT_SECRET", "not ours"], ["TRAKT_USER", ""]]))
  assert.deepEqual(set.map(({ setting, value }) => [setting.name, value]), [["LASTFM_API_KEY", "k"]])
  assert.deepEqual(missing.map((setting) => setting.name), ["LASTFM_USER", "TRAKT_CLIENT_ID", "TMDB_API_KEY", "TRAKT_USER"])
})

test("a run lacks only secrets, since a variable has its fallback", () => {
  assert.deepEqual(missingSecrets(SETTINGS, { LASTFM_API_KEY: "k", TRAKT_CLIENT_ID: "", TMDB_API_KEY: "t" }).map((setting) => setting.name), ["TRAKT_CLIENT_ID"])
  assert.ok(SETTINGS.every((setting) => setting.kind === "secret" || setting.fallback !== undefined))
})
