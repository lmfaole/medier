import { formatLabel, type Ownership } from "../lib/ownership"
import { platformOf, type Platform } from "../lib/platforms"
import { OtherPlatformIcon, PlatformIcon } from "./platform-icon"

/** One thing the collection says of a work's form: a logo, a named system, or a word (`Digitalt`). Each is once, however many lines say it. */
type Form = { key: string } & ({ kind: 'platform'; platform: Platform } | { kind: 'word'; text: string })

function formsOf(ownership: Ownership): Form[] {
  const forms = new Map<string, Form>()
  for (const line of ownership.lines) {
    for (const name of (line.format ?? "").split(",").map((part) => part.trim()).filter((part) => part !== "")) {
      const platform = platformOf(name)
      const form: Form = platform === null ? { key: `word:${name}`, kind: "word", text: formatLabel(name) ?? name } : { key: platform.kind === "brand" ? `brand:${platform.brand}` : "other", kind: "platform", platform }
      // Every system without a logo is the one icon; it names them all.
      const known = forms.get(form.key)
      if (known?.kind === "platform" && known.platform.kind === "other" && form.kind === "platform" && form.platform.kind === "other" && !known.platform.name.split(", ").includes(form.platform.name)) {
        forms.set(form.key, { ...form, platform: { kind: "other", name: `${known.platform.name}, ${form.platform.name}` } })
      } else if (known === undefined || form.kind === "word" || form.platform.kind === "brand") {
        forms.set(form.key, form)
      }
    }
  }
  return [...forms.values()]
}

/** The forms alone: the logos and words, for a card or for a popover. */
export function CollectionForms({ ownership }: { ownership: Ownership }) {
  const forms = formsOf(ownership)
  if (forms.length === 0) return null
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(0,max-content))] items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
      {forms.map((form) => (
        <li key={form.key} className="grid grid-flow-col items-center gap-2">
          {form.kind === "word" ? form.text : form.platform.kind === "brand" ? <PlatformIcon brand={form.platform.brand} className="size-7 text-foreground" /> : <OtherPlatformIcon name={form.platform.name} className="size-7 text-foreground" />}
        </li>
      ))}
    </ul>
  )
}

/** The words that head the forms: whether the owner has the work or wants it. */
export const collectionSentence = (ownership: Ownership): string => (ownership.status === "owned" ? "I samlingen min" : "På ønskelisten")
