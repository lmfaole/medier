// The front page, as little as it can be: the name and role, one sentence, and a few plain links.
import { PageHeader } from '@designsystem/ui/components/page-header'
import { ExternalLink } from '@lmfaole/designsystem/components/external-link'
import { Inline, PageColumn, Stack } from '@lmfaole/designsystem/components/layout'
import { Text, TextLink } from '@lmfaole/designsystem/components/text'

import { BIO, NAME, PROFILE, ROLE } from '@/lib/profile'

export function Forside() {
  return (
    <PageColumn as="main" gap="md">
      <PageHeader title={NAME} lead={ROLE} />
      <Stack gap="lg">
        <Stack width="prose">
          <Text size="lg">{BIO}</Text>
        </Stack>
        <Inline gap="lg">
          <TextLink href={PROFILE.cv}>CV</TextLink>
          <ExternalLink href={PROFILE.github}>GitHub</ExternalLink>
          <ExternalLink href={PROFILE.linkedin}>LinkedIn</ExternalLink>
          <TextLink href={`mailto:${PROFILE.email}`}>E-post</TextLink>
        </Inline>
      </Stack>
    </PageColumn>
  )
}
