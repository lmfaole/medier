// The whole page: who (the facts in the rail), then experience (with the projects and their latest commit) and education in one
// column. Props only, and rendered to HTML on the server with no client directive: nothing on the page needs a script.

import { PageHeader } from '@designsystem/ui/components/page-header'
import { PageColumn, Split } from '@lmfaole/designsystem/components/layout'
import { CvFacts, CvSections } from '@/components/cv-sections'
import type { Cv } from '@/server/cv'

export function Work({ cv }: { cv: Cv }) {
  return (
    <PageColumn as="main" gap="md">
      <PageHeader title={cv.person?.navn ?? 'Ole Jørgen Bakken'} lead={cv.person?.tittel ?? undefined} />
      <Split rail={<CvFacts cv={cv} />}>
        <CvSections cv={cv} />
      </Split>
    </PageColumn>
  )
}
