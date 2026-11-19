import { CV_EDUCATION, CV_EMPLOYERS, CV_LINKS, CV_PERSON, CV_POSITIONS, CV_PROJECTS } from "./collections/cv.ts"
import { GLOSSARY_TERMS } from "./collections/glossary.ts"
import { OG_PAGES } from "./collections/site.ts"
import type { Collection } from "./spec.ts"

/** Every collection that has a table, in the order the tables are written. */
export const COLLECTIONS: readonly Collection[] = [
  CV_PERSON,
  CV_EMPLOYERS,
  CV_POSITIONS,
  CV_EDUCATION,
  CV_PROJECTS,
  CV_LINKS,
  OG_PAGES,
  GLOSSARY_TERMS,
]
