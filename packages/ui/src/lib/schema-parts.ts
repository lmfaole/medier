/** The scalar schemas every app's `RESPONSES` is built from, so none of them declares its own copy. */
import * as v from 'valibot'

export const Text = v.string()
export const MaybeText = v.nullable(v.string())
export const Count = v.number()
export const MaybeCount = v.nullable(v.number())
