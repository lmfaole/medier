import type { Collection, Field } from "../spec.ts"

const SAMPLE = "packages/content/src/fixtures/cv.json"

const DESCRIPTIONS: readonly Field[] = [
  { key: "beskrivelse", title: "Description", kind: "string", nullable: true },
  { key: "kortbeskrivelse", title: "Short description", kind: "string", nullable: true },
]

export const CV_PERSON: Collection = {
  type: "cvPerson",
  database: "cv",
  rowType: "Person",
  title: "Person",
  sample: SAMPLE,
  section: "person",
  singleton: true,
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "navn", title: "Name", kind: "string" },
    { key: "tittel", title: "Title", kind: "string", nullable: true },
    { key: "arbeidsgiver", title: "Employer", kind: "string", nullable: true },
    { key: "sted", title: "Place", kind: "string", nullable: true },
    { key: "kilde", title: "Source", kind: "string", nullable: true },
    { key: "hentet", title: "Fetched", kind: "string", nullable: true },
  ],
}

export const CV_EMPLOYERS: Collection = {
  type: "cvEmployer",
  database: "cv",
  rowType: "Arbeidsgiver",
  title: "Employer",
  sample: SAMPLE,
  section: "arbeidsgivere",
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "navn", title: "Name", kind: "string" },
    { key: "sted", title: "Place", kind: "string", nullable: true },
  ],
}

/** A role at an employer; one employer can have several, one after the other, with a title and dates each. */
export const CV_POSITIONS: Collection = {
  type: "cvPosition",
  database: "cv",
  rowType: "Stilling",
  title: "Position",
  sample: SAMPLE,
  section: "stillinger",
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "arbeidsgiver_id", title: "Employer it was a role at (a role always has one)", kind: "integer" },
    { key: "fra", title: "From", kind: "string", nullable: true },
    { key: "til", title: "To (empty: still going)", kind: "string", nullable: true },
    { key: "aar", title: "Year", kind: "integer" },
    { key: "tittel", title: "Title", kind: "string" },
    ...DESCRIPTIONS,
  ],
}

export const CV_EDUCATION: Collection = {
  type: "cvEducation",
  database: "cv",
  rowType: "Utdanning",
  title: "Education",
  sample: SAMPLE,
  section: "utdanning",
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "fra", title: "From", kind: "string", nullable: true },
    { key: "til", title: "To (empty: still going)", kind: "string", nullable: true },
    { key: "aar", title: "Year", kind: "integer" },
    { key: "grad", title: "Degree", kind: "string" },
    { key: "institusjon", title: "Institution", kind: "string", nullable: true },
    ...DESCRIPTIONS,
  ],
}

export const CV_PROJECTS: Collection = {
  type: "cvProject",
  database: "cv",
  rowType: "Prosjekt",
  title: "Project",
  sample: SAMPLE,
  section: "prosjekter",
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "stilling_id", title: "Position it was done in (a project always belongs to one)", kind: "integer" },
    { key: "fra", title: "From", kind: "string", nullable: true },
    { key: "til", title: "To (empty: still going)", kind: "string", nullable: true },
    { key: "aar", title: "Year", kind: "integer" },
    { key: "navn", title: "Name", kind: "string", nullable: true },
    { key: "tittel", title: "Title", kind: "string", nullable: true },
    { key: "url", title: "Address", kind: "string", nullable: true },
    { key: "repo", title: "GitHub repository, public (owner/name); its latest commit by the owner is shown", kind: "string", nullable: true },
    ...DESCRIPTIONS,
  ],
}

export const CV_LINKS: Collection = {
  type: "cvLink",
  database: "cv",
  rowType: "CvLenke",
  title: "Link",
  sample: SAMPLE,
  section: "lenker",
  idField: "id",
  orderField: "id",
  fields: [
    { key: "id", title: "Id", kind: "integer" },
    { key: "navn", title: "Name", kind: "string" },
    { key: "url", title: "Address", kind: "string" },
  ],
}
