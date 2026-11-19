import { appUrl } from "../lib/base-url";
import { coverRatioOf } from "../lib/cover-ratio";
import type { AppId } from "../lib/apps";
import { NOTHING_YET } from "../lib/empty-states";
import { ENTITY_LINK } from "@lmfaole/designsystem/lib/link-style";
import { MediaRows, type MediaRow } from "./media-rows";
import { PageHeader } from "./page-header";
import { PageSection } from "@lmfaole/designsystem/components/page-section";
import { Text } from "@lmfaole/designsystem/components/text";

interface FrontPageProps {
  /** The app: the shape of the pictures in the latest list follows from it. */
  app: AppId;
  title: string;
  lead?: string;
  /** The latest of the log, twenty at most, newest first: what the list is called («Sist spilt», «Sist sett») and its rows. */
  latest: { title: string; rows: readonly MediaRow[] };
}

/** The front page of a media app: the latest from its log with a link to all of it. */
export function FrontPage({ app, title, lead, latest }: FrontPageProps) {
  return (
    <>
      <PageHeader title={title} {...(lead === undefined ? {} : { lead })} />
      <PageSection id="latest" title={latest.title}>
        <div className="grid gap-4">
          {latest.rows.length === 0 ? (
            <Text size="sm" tone="muted">
              {NOTHING_YET}
            </Text>
          ) : (
            <MediaRows rows={latest.rows} coverRatio={coverRatioOf(app)} />
          )}
          <p>
            <a
              href={appUrl("/historikk")}
              data-astro-prefetch=""
              className={`${ENTITY_LINK} font-medium`}
            >
              Se hele historikken
            </a>
          </p>
        </div>
      </PageSection>
    </>
  );
}
