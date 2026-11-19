/**
 * `/api/cv.json`: the CV, read from `cv.db` by named columns, so a column added to a table (a
 * note on where a row came from, a date it was fetched) is not published until it is listed here.
 * Education after primary school only: the grunnskole rows say where the owner grew up.
 * Projects are published inside the position they belong to (`stilling_id`, never empty).
 */

import { queryRows } from '@designsystem/config/d1-query'
import { GITHUB_PROJECT_COMMITS_TABLE, GithubProjectCommitRow } from '@designsystem/contracts/github-tables'
import * as v from 'valibot'

export const SQL = {
  person: 'SELECT navn, tittel, arbeidsgiver, sted FROM cv_person ORDER BY id LIMIT 1',
  employers: 'SELECT id, navn, sted FROM cv_employer',
  positions: 'SELECT id, arbeidsgiver_id, aar, fra, til, tittel, beskrivelse FROM cv_position ORDER BY fra DESC, id DESC',
  education: "SELECT aar, fra, til, grad, institusjon, beskrivelse FROM cv_education WHERE grad NOT LIKE 'Grunnskole%' ORDER BY fra DESC, id DESC",
  // A repository is published only with a commit `work-sync` fetched without a token, which only a public one gives.
  projects: `SELECT project.stilling_id, project.aar, project.fra, project.til, project.navn, project.tittel, project.url, project.beskrivelse,
      commit_row.repo AS repo, commit_row.message AS commit_message, commit_row.committed_at AS commit_at, commit_row.url AS commit_url
    FROM cv_project AS project LEFT JOIN ${GITHUB_PROJECT_COMMITS_TABLE} AS commit_row ON commit_row.repo = project.repo
    ORDER BY project.fra DESC, project.id DESC`,
  links: 'SELECT navn, url FROM cv_link ORDER BY id',
}

const Text = v.nullable(v.string())
const PersonRow = v.object({ navn: v.string(), tittel: Text, arbeidsgiver: Text, sted: Text })
const EmployerRow = v.object({ id: v.number(), navn: v.string(), sted: Text })
const PositionRow = v.object({ id: v.number(), arbeidsgiver_id: v.number(), aar: v.number(), fra: Text, til: Text, tittel: v.string(), beskrivelse: Text })
const EducationRow = v.object({ aar: v.number(), fra: Text, til: Text, grad: v.string(), institusjon: Text, beskrivelse: Text })
const ProjectRow = v.object({
  stilling_id: v.number(),
  aar: v.number(),
  fra: Text,
  til: Text,
  navn: Text,
  tittel: Text,
  url: Text,
  beskrivelse: Text,
  repo: v.nullable(GithubProjectCommitRow.entries.repo),
  commit_message: v.nullable(GithubProjectCommitRow.entries.message),
  commit_at: v.nullable(GithubProjectCommitRow.entries.committed_at),
  commit_url: v.nullable(GithubProjectCommitRow.entries.url),
})
const LinkRow = v.object({ navn: v.string(), url: v.string() })

type ProjectInRow = v.InferOutput<typeof ProjectRow>

/** A project as published: the commit columns become one `github` part, there only with a commit. */
export interface Project extends Pick<ProjectInRow, 'aar' | 'fra' | 'til' | 'navn' | 'tittel' | 'url' | 'beskrivelse'> {
  github: { repo: string; commit: { message: string; at: string; url: string } } | null
}

function published({ stilling_id: _, repo, commit_message, commit_at, commit_url, ...project }: ProjectInRow): Project {
  const github = repo !== null && commit_message !== null && commit_at !== null && commit_url !== null ? { repo, commit: { message: commit_message, at: commit_at, url: commit_url } } : null
  return { ...project, github }
}
type Role = Omit<v.InferOutput<typeof PositionRow>, 'id' | 'arbeidsgiver_id'> & { projects: Project[] }

/** An employer and the roles held there, newest first. */
export interface Employer {
  navn: string
  sted: string | null
  roles: Role[]
}

export interface Cv {
  person: v.InferOutput<typeof PersonRow> | null
  employers: Employer[]
  education: v.InferOutput<typeof EducationRow>[]
  links: v.InferOutput<typeof LinkRow>[]
}

/**
 * The employers, each with its roles and each role with its projects, ordered by the newest role. A
 * project of a role that does not exist, and an employer with no role, are not shown.
 */
export function employersWithRoles(
  employers: v.InferOutput<typeof EmployerRow>[],
  positions: v.InferOutput<typeof PositionRow>[],
  projects: ProjectInRow[],
): Employer[] {
  const found: Employer[] = []
  for (const employer of employers) {
    const roles = positions
      .filter((position) => position.arbeidsgiver_id === employer.id)
      .map(({ id, arbeidsgiver_id: _, ...role }) => ({
        ...role,
        projects: projects.filter((project) => project.stilling_id === id).map(published),
      }))
    if (roles.length === 0) continue
    found.push({ navn: employer.navn, sted: employer.sted, roles })
  }
  return found.toSorted((a, b) => (b.roles[0]?.fra ?? '').localeCompare(a.roles[0]?.fra ?? ''))
}

export async function cv(db: D1Database): Promise<Cv> {
  const [person, employers, positions, education, projects, links] = await Promise.all([
    queryRows(db, SQL.person, PersonRow),
    queryRows(db, SQL.employers, EmployerRow),
    queryRows(db, SQL.positions, PositionRow),
    queryRows(db, SQL.education, EducationRow),
    queryRows(db, SQL.projects, ProjectRow),
    queryRows(db, SQL.links, LinkRow),
  ])
  return { person: person[0] ?? null, employers: employersWithRoles(employers, positions, projects), education, links }
}
