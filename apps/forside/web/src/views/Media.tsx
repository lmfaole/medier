// `/medier`: the way into each media app at the top, and under it the latest of all of them in one timeline, a day at a
// time. The page reads `timeline.json` while it renders on the server, so the timeline is in the HTML.

import type { ReactNode } from "react";

import { AppList } from "@designsystem/ui/components/app-list";
import { Inline, PageColumn, Stack } from "@lmfaole/designsystem/components/layout";
import { PageHeader } from "@designsystem/ui/components/page-header";
import { MediaTimeline } from "@designsystem/ui/components/media-timeline";
import { Heading, TextLink } from "@lmfaole/designsystem/components/text";
import { appsInGroup } from "@designsystem/ui/lib/apps";

import { pageHead } from "@/lib/profile";
import type { ApiResponses } from "../server/api.ts";

/** `children` stands under the heading of the log: the page's server island, which says how fresh the log is. */
export function Media({
  timeline,
  children,
}: {
  timeline: ApiResponses["timeline"];
  children?: ReactNode;
}) {
  const page = pageHead("/medier");

  return (
    <PageColumn as="main" gap="md">
      <PageHeader title={page.title} lead={page.description} />
      <Stack gap="xl">
        <AppList apps={appsInGroup("media")} variant="rail" label="Appene" />
        <Stack as="section" aria-labelledby="latest">
          <Inline justify="between" align="baseline">
            <Heading level={2} look="label" id="latest">
              Logg
            </Heading>
            <TextLink href="/kilder">
              Kilder
            </TextLink>
          </Inline>
          {children}
          <MediaTimeline entries={timeline.entries} />
        </Stack>
      </Stack>
    </PageColumn>
  );
}
