// The hub: every media app with a line about it, and under them the latest of all of them in one timeline. The page
// reads `timeline.json` while it renders on the server, so the timeline is in the HTML.

import { AppList } from '@designsystem/ui/components/app-list'
import { PageColumn, Stack } from '@lmfaole/designsystem/components/layout'
import { MediaTimeline } from '@designsystem/ui/components/media-timeline'
import { Heading, Text } from '@lmfaole/designsystem/components/text'
import { listApps } from '@designsystem/ui/lib/apps'
import { HUB } from '@designsystem/ui/lib/hub'

import type { ApiResponses } from '../server/api.ts'

export function Hub({ timeline }: { timeline: ApiResponses['timeline'] }) {
  return (
    <PageColumn as="main">
      <Stack as="header" gap="sm">
        <Heading level={1}>{HUB.label}</Heading>
        <Text tone="muted">{HUB.description}</Text>
      </Stack>
      <Stack gap="xl">
        <AppList apps={listApps()} variant="rail" label="Mediaappene" />
        <Stack as="section" aria-labelledby="latest">
          <Heading level={2} id="latest">
            Siste
          </Heading>
          <MediaTimeline entries={timeline.entries} />
        </Stack>
      </Stack>
    </PageColumn>
  )
}
