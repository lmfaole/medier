/** Questions on the terminal for the setup scripts; a token is read without echoing it. */

import { createInterface } from "node:readline/promises"

export async function ask(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout })
  const value = await reader.question(question)
  reader.close()
  return value.trim()
}
