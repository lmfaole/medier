import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"

import { cv } from "./cv.ts"

/** The CV's database with the GitHub database attached under its own name, as the snapshot opens them. */
function database(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:")
  const githubFile = join(mkdtempSync(join(tmpdir(), "work-cv-")), "github.db")
  const github = new DatabaseSync(githubFile)
  github.exec(readFileSync(new URL("../../../../../db/github.sql", import.meta.url), "utf8"))
  github.exec("INSERT INTO github_project_commits (repo, sha, message, committed_at, url) VALUES ('example/engine', 'abc', 'fix: a thing', '2026-09-24T12:30:38Z', 'https://github.com/example/engine/commit/abc')")
  github.close()
  sqlite.exec(`ATTACH DATABASE '${githubFile}' AS github`)
  sqlite.exec(readFileSync(new URL("../../../../../db/cv.sql", import.meta.url), "utf8"))
  sqlite.exec(`
    INSERT INTO cv_person (id, navn, tittel, arbeidsgiver, sted, kilde, hentet) VALUES (1, 'Ada Lovelace', 'Engineer', 'Analytical Engines', 'London', 'a private source note', '2026-01-01');
    INSERT INTO cv_employer (id, navn, sted) VALUES (1, 'Analytical Engines', 'London'), (2, 'Empty Inc', 'Nowhere');
    INSERT INTO cv_position (id, arbeidsgiver_id, fra, til, aar, tittel, beskrivelse, kortbeskrivelse) VALUES
      (1, 1, '2025-01-01', NULL, 2025, 'Lead', 'Long text', 'Short'),
      (2, 1, '2022-03-01', '2024-12-31', 2022, 'Engineer', 'Built it', 'x');
    INSERT INTO cv_education (id, fra, aar, grad, institusjon, beskrivelse, kortbeskrivelse) VALUES
      (1, '2003-08-01', 2010, 'Grunnskole, 1.–7. trinn', 'A primary school', 'Where I grew up', 'x'),
      (2, '2013-08-01', 2016, 'Bachelor', 'A university', 'Studies', 'y');
    INSERT INTO cv_project (id, stilling_id, fra, aar, navn, tittel, url, beskrivelse, kortbeskrivelse, repo) VALUES (1, 1, '2024-01-01', 2024, 'Engine', 'Engine – A client', 'https://example.org', 'About it', 'Short', 'example/engine');
    INSERT INTO cv_link (id, navn, url) VALUES (1, 'Blog', 'https://example.org/blog');
  `)
  return sqlite
}

test("the CV is the person, the positions, the projects, the links and the education after primary school", async () => {
  const published = await cv(sqliteAsD1(database()))

  assert.equal(published.person?.navn, "Ada Lovelace")
  assert.deepEqual(published.education.map((row) => row.institusjon), ["A university"])
  assert.equal(published.employers[0]?.roles[0]?.tittel, "Lead")
  assert.equal(published.employers[0]?.roles[0]?.projects[0]?.navn, "Engine")
  assert.equal(published.links[0]?.url, "https://example.org/blog")
})

test("the provenance of a CV row is not published", async () => {
  const published = JSON.stringify(await cv(sqliteAsD1(database())))
  assert.ok(!published.includes("a private source note"))
  assert.ok(!published.includes("2026-01-01"))
})

test("one employer holds its roles, newest first", async () => {
  const published = await cv(sqliteAsD1(database()))
  const [employer] = published.employers

  assert.deepEqual(published.employers.map((row) => row.navn), ["Analytical Engines"])
  assert.deepEqual(employer?.roles.map((role) => role.tittel), ["Lead", "Engineer"])
})

test("a project is shown under its role, and a project of a role that is not there is not shown", async () => {
  const sqlite = database()
  sqlite.exec(`INSERT INTO cv_project (id, stilling_id, fra, aar, navn, tittel, url, beskrivelse, kortbeskrivelse) VALUES (2, 99, '2024-02-01', 2024, 'Orphan', 'Orphan', NULL, 'Nowhere', 'x')`)

  const published = await cv(sqliteAsD1(sqlite))

  assert.deepEqual(published.employers.flatMap((employer) => employer.roles.flatMap((role) => role.projects.map((project) => project.navn))), ["Engine"])
  assert.ok(!JSON.stringify(published).includes("Orphan"))
})

test("a project shows its repository and the latest commit only when the sync fetched one", async () => {
  const sqlite = database()
  // A repository the sync could not see (private, or no commit by the owner) has no row, so its name is not published.
  sqlite.exec(`INSERT INTO cv_project (id, stilling_id, fra, aar, navn, tittel, url, beskrivelse, kortbeskrivelse, repo) VALUES (3, 2, '2023-01-01', 2023, 'Hidden', 'Hidden', NULL, NULL, NULL, 'employer/secret-repo')`)

  const published = await cv(sqliteAsD1(sqlite))
  const projects = published.employers.flatMap((employer) => employer.roles.flatMap((role) => role.projects))

  assert.deepEqual(projects.find((project) => project.navn === "Engine")?.github, {
    repo: "example/engine",
    commit: { message: "fix: a thing", at: "2026-09-24T12:30:38Z", url: "https://github.com/example/engine/commit/abc" },
  })
  assert.equal(projects.find((project) => project.navn === "Hidden")?.github, null)
  assert.ok(!JSON.stringify(published).includes("secret-repo"))
})
