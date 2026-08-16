/** Validate and replace one explicitly configured OpenAPI source. */

import { writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { z } from 'zod'
import { parse as parseYaml } from 'yaml'

import { resolveApiSourcePath } from '../lib/api-spec.js'

export const updateApiSpecSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project root'),
  source: z
    .string()
    .optional()
    .describe('Configured OpenAPI source; omit when the project has one'),
  content: z
    .string()
    .min(2)
    .max(512_000)
    .describe('Complete replacement OpenAPI JSON or YAML document'),
})

export type UpdateApiSpecInput = z.infer<typeof updateApiSpecSchema>

function parseDocument(source: string, content: string): unknown {
  try {
    return extname(source).toLowerCase() === '.json' ? JSON.parse(content) : parseYaml(content)
  } catch {
    throw new Error(
      `OpenAPI source is not valid ${extname(source).toLowerCase() === '.json' ? 'JSON' : 'YAML'}.`,
    )
  }
}

export async function handleUpdateApiSpec(input: UpdateApiSpecInput): Promise<string> {
  const source = resolveApiSourcePath(input.projectDir, input.source)
  const parsed = parseDocument(source.source, input.content)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !('openapi' in parsed) ||
    !('paths' in parsed)
  ) {
    throw new Error('OpenAPI source must contain top-level openapi and paths fields.')
  }
  const content = input.content.endsWith('\n') ? input.content : `${input.content}\n`
  writeFileSync(source.path, content, 'utf8')
  return `✅ API source updated: ${source.source}`
}
