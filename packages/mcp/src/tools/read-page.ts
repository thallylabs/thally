import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'

import { readPageBodyDelimiter } from '../lib/page-echo.js'

export const readPageSchema = z.object({
  projectDir: z.string().describe('Path to the Thally project root'),
  pageId: z.string().describe('Page ID, e.g. "guides/authentication"'),
})

export type ReadPageInput = z.infer<typeof readPageSchema>

export async function handleReadPage(input: ReadPageInput): Promise<string> {
  const { projectDir, pageId } = input
  const contentDir = join(projectDir, 'src', 'content')

  const candidates = [
    join(contentDir, `${pageId}.mdx`),
    join(contentDir, `${pageId}/index.mdx`),
  ]

  let filePath: string | null = null
  for (const c of candidates) {
    if (existsSync(c)) {
      filePath = c
      break
    }
  }

  if (!filePath) {
    throw new Error(`Page not found: "${pageId}". No file at src/content/${pageId}.mdx`)
  }

  const raw = readFileSync(filePath, 'utf8')
  const { data, content } = matter(raw)
  const title = (data.title as string | undefined) ?? pageId
  const description = (data.description as string | undefined) ?? ''

  // Present metadata as labelled fields, not markdown, and fence the body
  // behind an explicit delimiter. Models mirror what they read: the old
  // H1/blockquote preamble kept getting echoed back through update_page and
  // persisted into src/content on every agent edit.
  const lines = [`id: ${pageId}`, `title: ${title}`]
  if (description) lines.push(`description: ${description}`)
  lines.push('', readPageBodyDelimiter(), '', content.trim())

  return lines.join('\n')
}
