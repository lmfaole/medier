/**
 * A row of `glossary.json`: a name that comes up in many texts and that no source holds an address for. The Studio's spec (`packages/content`) must match it.
 */

import * as v from "valibot"


/** A row as the file holds it, and as the Studio's spec must match. The id is a slug of the term. */
export const GlossaryRow = v.object({ id: v.string(), term: v.string(), url: v.string() })
