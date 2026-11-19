// The credit the registers' terms ask for: the facts and the covers come from them.

import { ExternalLink } from '@lmfaole/designsystem/components/external-link'

import type { ShelfWords } from '../words.ts'

export function Credit({ credit }: { credit: ShelfWords['credit'] }) {
  return (
    <p className="text-sm text-muted-foreground">
      Fakta og omslag fra <ExternalLink href={credit.href}>{credit.name}</ExternalLink>. Siden er ikke godkjent av {credit.name}.
    </p>
  )
}
