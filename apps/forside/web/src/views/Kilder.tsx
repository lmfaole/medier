// `/kilder`: where the media apps' content comes from and when each source is next fetched, from `lib/sources.ts`, as tables.
// The rhythm is in the HTML; the next time is worked out in the browser (`NextSync`).
import { PageHeader } from '@designsystem/ui/components/page-header'
import { DataCell } from '@lmfaole/designsystem/components/data-cell'
import { PageColumn, Stack } from '@lmfaole/designsystem/components/layout'
import { PageSection } from '@lmfaole/designsystem/components/page-section'
import { Text, TextLink } from '@lmfaole/designsystem/components/text'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@lmfaole/designsystem/components/table'
import { APPS } from '@designsystem/ui/lib/apps'

import { nearest, nextText, useNow } from '@/components/NextSync'
import { pageHead } from '@/lib/profile'
import { ACCOUNTS, KIND_LABELS, SOURCES, type Source } from '@/lib/sources'

/** A source's name, a link where it has a site of its own. */
function SourceName({ source }: { source: Source }) {
  return source.href === null ? (
    <Text as="span">
      {source.label}
    </Text>
  ) : (
    <TextLink href={source.href} external>
      {source.label}
    </TextLink>
  )
}

/** Each app and when it next fetches, the soonest first once the clock is read. */
function NextSyncTable({ now }: { now: Date | null }) {
  const rows = SOURCES.map(({ app, sources }) => ({
    app,
    rhythm: sources.find((source) => source.schedule !== null)?.when ?? 'når jeg ber om det',
    next: nearest(sources.flatMap((source) => (source.schedule === null ? [] : [source.schedule])), now),
  })).toSorted((a, b) => a.next.at - b.next.at)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>App</TableHead>
          <TableHead>Hvor ofte</TableHead>
          <TableHead>Neste</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.app}>
            <DataCell weight="medium">{APPS[row.app].label}</DataCell>
            <DataCell tone="muted">{row.rhythm}</DataCell>
            <DataCell numeric>{row.next.text}</DataCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function Kilder() {
  const page = pageHead('/kilder')
  const now = useNow()
  return (
    <PageColumn as="main" gap="md">
      <PageHeader title={page.title} lead={page.description} />
      <Stack gap="xl">
        <PageSection id="next" title="Neste synk">
          <NextSyncTable now={now} />
        </PageSection>
        <PageSection id="accounts" title="Kontoene mine">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tjeneste</TableHead>
                <TableHead>Konto</TableHead>
                <TableHead>Brukes til</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ACCOUNTS.map((account) => (
                <TableRow key={account.service}>
                  <DataCell>
                    <TextLink href={account.href} external>
                      {account.service}
                    </TextLink>
                  </DataCell>
                  <DataCell tone="muted">{account.name}</DataCell>
                  <DataCell tone="muted">{account.used}</DataCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageSection>
        {SOURCES.map(({ app, sources }) => (
          <PageSection key={app} id={`sources-${app}`} title={APPS[app].label}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kilde</TableHead>
                  <TableHead>Hva</TableHead>
                  <TableHead>Hentes</TableHead>
                  <TableHead>Hvor ofte</TableHead>
                  <TableHead>Neste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <TableRow key={source.label}>
                    <DataCell>
                      <SourceName source={source} />
                    </DataCell>
                    <DataCell tone="muted" wrap>
                      {source.note}
                    </DataCell>
                    <DataCell tone="muted">{KIND_LABELS[source.kind]}</DataCell>
                    <DataCell tone="muted">{source.when}</DataCell>
                    <DataCell numeric>{nextText(source.schedule, now)}</DataCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageSection>
        ))}
      </Stack>
    </PageColumn>
  )
}
