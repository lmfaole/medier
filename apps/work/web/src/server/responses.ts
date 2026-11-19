/**
 * The schema of the API file the page reads (`readApi`), next to the loader: `RESPONSES` must produce what
 * `API` returns, so a loader that changes its answer fails the typecheck here until its schema follows. No SQL is
 * imported, so the page can take this at run time.
 */
import * as v from 'valibot'

import type { ApiResponses } from './api.ts'

const Text = v.nullable(v.string())

const Project = v.object({
  aar: v.number(),
  fra: Text,
  til: Text,
  navn: Text,
  tittel: Text,
  url: Text,
  beskrivelse: Text,
  github: v.nullable(v.object({ repo: v.string(), commit: v.object({ message: v.string(), at: v.string(), url: v.string() }) })),
})

const Role = v.object({ aar: v.number(), fra: Text, til: Text, tittel: v.string(), beskrivelse: Text, projects: v.array(Project) })

const CvResponse = v.object({
  person: v.nullable(v.object({ navn: v.string(), tittel: Text, arbeidsgiver: Text, sted: Text })),
  employers: v.array(v.object({ navn: v.string(), sted: Text, roles: v.array(Role) })),
  education: v.array(v.object({ aar: v.number(), fra: Text, til: Text, grad: v.string(), institusjon: Text, beskrivelse: Text })),
  links: v.array(v.object({ navn: v.string(), url: v.string() })),
})

export const RESPONSES = { cv: CvResponse } satisfies {
  [File in keyof ApiResponses]: v.GenericSchema<unknown, ApiResponses[File]>
}
