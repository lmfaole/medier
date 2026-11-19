/**
 * The pure part of `npm run film:inbox`: which submissions of the Nextcloud Forms form «Logg en film» (answered by the
 * logged-in owner, but Forms is not the log, so every answer is checked again here) the film log lacks, which are done
 * with, and which are refused.
 */

import { filmLogKey, filmLogLine, readFilmLogEntry } from "@designsystem/watch/film-log-entry"

/** The form's questions, by the text they carry in Forms (the inbox's contract with the form; `docs/CONVENTIONS.md`). */
export const FORM_QUESTIONS = { watchedOn: "Dag", title: "Tittel", year: "År", rating: "Vurdering", cinema: "Kino", note: "Notat" } as const

export interface Submission {
  id: number
  /** The answer text per question text: what Forms stored, a dropdown's option as its text. */
  answers: Record<string, string>
}

export interface InboxPlan {
  /** Lines for the log: valid and not in it yet. */
  toLog: string[]
  /** Ids of every valid submission, new or already in the log: they are not read again. */
  processed: number[]
  /** Submissions that break a rule of the log: they are reported every run until deleted in Forms. */
  refused: number[]
}

const linesOf = (text: string): string[] => text.split("\n").map((line) => line.replace(/\r$/, "")).filter((line) => line.trim() !== "")

/** The submissions the query printed, one JSON object per line. */
export function parseSubmissions(output: string): Submission[] {
  return linesOf(output).map((line) => {
    const row: unknown = JSON.parse(line)
    if (typeof row !== "object" || row === null || !("id" in row) || !("answers" in row) || typeof row.id !== "number" || typeof row.answers !== "object" || row.answers === null) {
      throw new Error(`not a submission: ${line}`)
    }
    const answers: Record<string, string> = {}
    for (const [question, answer] of Object.entries(row.answers)) if (typeof answer === "string") answers[question] = answer
    return { id: row.id, answers }
  })
}

/** The log line one submission makes, or null when a rule of the log is broken. */
export function lineOf(submission: Submission): string | null {
  const answer = (question: string): string => submission.answers[question] ?? ""
  const entry = readFilmLogEntry({
    watchedOn: answer(FORM_QUESTIONS.watchedOn),
    title: answer(FORM_QUESTIONS.title),
    year: answer(FORM_QUESTIONS.year),
    rating: answer(FORM_QUESTIONS.rating),
    note: answer(FORM_QUESTIONS.note),
    cinema: answer(FORM_QUESTIONS.cinema),
  })
  return entry === null ? null : filmLogLine(entry)
}

/** Submissions not in `seen` against the log's text: a viewing the log has (same day and title, any case) is only marked done. */
export function planInbox(submissions: Submission[], log: string, seen: ReadonlySet<number>): InboxPlan {
  const known = new Set(linesOf(log).map(filmLogKey))
  const plan: InboxPlan = { toLog: [], processed: [], refused: [] }
  for (const submission of submissions.toSorted((a, b) => a.id - b.id)) {
    if (seen.has(submission.id)) continue
    const line = lineOf(submission)
    if (line === null) {
      plan.refused.push(submission.id)
      continue
    }
    plan.processed.push(submission.id)
    const key = filmLogKey(line)
    if (known.has(key)) continue
    known.add(key)
    plan.toLog.push(line)
  }
  return plan
}

/** `text` with the lines added, one per line, after a newline if the file lacked its last one. */
export function withLines(text: string, lines: string[]): string {
  return lines.length === 0 ? text : `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${lines.join("\n")}\n`
}

/** The ids a seen-file holds (one per line; anything else is ignored). */
export function readSeen(text: string): Set<number> {
  return new Set(linesOf(text).map(Number).filter((id) => Number.isInteger(id) && id > 0))
}
