// The CV's parts, newest first. A description is the owner's own text, in Norwegian as written.

import type { Cv } from "@/server/cv";
import { formatTime } from "@designsystem/intl/time";
import {
  DatedEntry,
  EntryGroup,
  EntryList,
  GroupItem,
  SubItem,
  SubItems,
} from "@lmfaole/designsystem/components/entry-list";
import { ExternalLink } from "@lmfaole/designsystem/components/external-link";

import { FactList } from "@lmfaole/designsystem/components/fact-list";
import { Stack } from "@lmfaole/designsystem/components/layout";
import { Text } from "@lmfaole/designsystem/components/text";
import { PageSection } from "@lmfaole/designsystem/components/page-section";

import { periodLabel } from "@/lib/period";

/** The facts about the person for the rail: the position, the employer, the place and the other places on the web. */
export function CvFacts({ cv }: { cv: Cv }) {
  const { person } = cv;
  return (
    <FactList
      facts={[
        ["Arbeidsgiver", person?.arbeidsgiver],
        ["Sted", person?.sted],
        [
          "Andre steder",
          cv.links.length > 0 ? (
            <Stack as="ul" gap="xs">
              {cv.links.map((link) => (
                <li key={link.url}>
                  <ExternalLink href={link.url}>{link.navn}</ExternalLink>
                </li>
              ))}
            </Stack>
          ) : null,
        ],
      ]}
    />
  );
}

/** The CV's sections for the main column, one under the other: the experience, then the education. */
export function CvSections({ cv }: { cv: Cv }) {
  return (
    <>
      <PageSection id="erfaring" title="Erfaring">
        <EntryList>
          {cv.employers.map((employer) => (
            <EntryGroup key={employer.navn} name={employer.navn} place={employer.sted}>
              {employer.roles.map((role) => (
                <GroupItem
                  key={`${role.fra}-${role.tittel}`}
                  title={role.tittel}
                  period={periodLabel(role.fra, role.til, role.aar)}
                  description={role.beskrivelse}
                >
                  {role.projects.length > 0 ? (
                    <SubItems label={`Prosjekter som ${role.tittel} hos ${employer.navn}`}>
                      {role.projects.map((project) => (
                        <SubItem
                          key={`${project.fra}-${project.tittel ?? project.navn}`}
                          title={project.tittel ?? project.navn}
                          url={project.url}
                          description={project.beskrivelse}
                        >
                          {project.github ? (
                            <Text size="sm" tone="muted">
                              Siste commit hos{" "}
                              <ExternalLink href={`https://github.com/${project.github.repo}`}>
                                {project.github.repo}
                              </ExternalLink>
                              :{" "}
                              <ExternalLink href={project.github.commit.url}>
                                {project.github.commit.message}
                              </ExternalLink>{" "}
                              ({formatTime(project.github.commit.at, "date")})
                            </Text>
                          ) : null}
                        </SubItem>
                      ))}
                    </SubItems>
                  ) : null}
                </GroupItem>
              ))}
            </EntryGroup>
          ))}
        </EntryList>
      </PageSection>
      <PageSection id="utdanning" title="Utdanning">
        <EntryList>
          {cv.education.map((education) => (
            <DatedEntry
              key={`${education.fra}-${education.grad}`}
              period={periodLabel(education.fra, education.til, education.aar)}
              title={education.grad}
              meta={education.institusjon ?? ""}
              text={education.beskrivelse}
            />
          ))}
        </EntryList>
      </PageSection>
    </>
  );
}
