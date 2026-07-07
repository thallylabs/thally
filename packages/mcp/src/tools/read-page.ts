import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'

export const readPageSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
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

  const lines = [`# ${title}`, `*${pageId}*`, '']

  if (description) {
    lines.push(`> ${description}`)
    lines.push('')
  }

  lines.push('---', '', content.trim())

  return lines.join('\n')
}
