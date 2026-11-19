// Generated from the collection specs by `npm run generate --workspace @designsystem/content`. Never edit by hand.

import * as v from "valibot"

export const PersonRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  navn: v.string(),
  tittel: v.nullable(v.string()),
  arbeidsgiver: v.nullable(v.string()),
  sted: v.nullable(v.string()),
  kilde: v.nullable(v.string()),
  hentet: v.nullable(v.string()),
})
export type Person = v.InferOutput<typeof PersonRow>

export const ArbeidsgiverRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  navn: v.string(),
  sted: v.nullable(v.string()),
})
export type Arbeidsgiver = v.InferOutput<typeof ArbeidsgiverRow>

export const StillingRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  arbeidsgiver_id: v.pipe(v.number(), v.integer()),
  fra: v.nullable(v.string()),
  til: v.nullable(v.string()),
  aar: v.pipe(v.number(), v.integer()),
  tittel: v.string(),
  beskrivelse: v.nullable(v.string()),
  kortbeskrivelse: v.nullable(v.string()),
})
export type Stilling = v.InferOutput<typeof StillingRow>

export const UtdanningRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  fra: v.nullable(v.string()),
  til: v.nullable(v.string()),
  aar: v.pipe(v.number(), v.integer()),
  grad: v.string(),
  institusjon: v.nullable(v.string()),
  beskrivelse: v.nullable(v.string()),
  kortbeskrivelse: v.nullable(v.string()),
})
export type Utdanning = v.InferOutput<typeof UtdanningRow>

export const ProsjektRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  stilling_id: v.pipe(v.number(), v.integer()),
  fra: v.nullable(v.string()),
  til: v.nullable(v.string()),
  aar: v.pipe(v.number(), v.integer()),
  navn: v.nullable(v.string()),
  tittel: v.nullable(v.string()),
  url: v.nullable(v.string()),
  repo: v.nullable(v.string()),
  beskrivelse: v.nullable(v.string()),
  kortbeskrivelse: v.nullable(v.string()),
})
export type Prosjekt = v.InferOutput<typeof ProsjektRow>

export const CvLenkeRow = v.object({
  id: v.pipe(v.number(), v.integer()),
  navn: v.string(),
  url: v.string(),
})
export type CvLenke = v.InferOutput<typeof CvLenkeRow>
