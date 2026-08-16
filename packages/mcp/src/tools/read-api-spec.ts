/** Read one explicitly configured OpenAPI source for documentation work. */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

import { resolveApiSourcePath } from '../lib/api-spec.js'

export const readApiSpecSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project root'),
  source: z
    .string()
    .optional()
    .describe('Configured OpenAPI source; omit when the project has one'),
})

export type ReadApiSpecInput = z.infer<typeof readApiSpecSchema>

export async function handleReadApiSpec(input: ReadApiSpecInput): Promise<string> {
  const source = resolveApiSourcePath(input.projectDir, input.source)
  return [`API source: ${source.source}`, '', readFileSync(source.path, 'utf8')].join('\n')
}
