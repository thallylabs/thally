import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { scanMdxFiles, scoreFiles } from './search-docs.js'

export const getContextSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
  topic: z.string().describe('Topic or question to find relevant docs for'),
  maxTokens: z.number().optional().default(4000).describe('Approximate token budget for returned context (default 4000)'),
})

export type GetContextInput = z.infer<typeof getContextSchema>

export async function handleGetContext(input: GetContextInput): Promise<string> {
  const { projectDir, topic, maxTokens = 4000 } = input
  const contentDir = join(projectDir, 'src', 'content')

  if (!existsSync(contentDir)) {
    throw new Error(`Content directory not found: ${contentDir}`)
  }

  const files: string[] = []
  scanMdxFiles(contentDir, files)

  // Score all pages against the topic, take top 10 candidates
  const scored = scoreFiles(files, contentDir, topic).slice(0, 10)

  if (scored.length === 0) {
    return `No relevant documentation found for "${topic}".`
  }

  // ~4 chars per token, use 80% of budget to leave room for system prompts
  const charBudget = Math.floor(maxTokens * 4 * 0.8)
  let usedChars = 0
  const sections: string[] = []

  for (const result of scored) {
    const candidates = [
      join(contentDir, `${result.pageId}.mdx`),
      join(contentDir, `${result.pageId}/index.mdx`),
    ]

    let content = ''
    for (const c of candidates) {
      if (existsSync(c)) {
        const raw = readFileSync(c, 'utf8')
        const { content: body } = matter(raw)
        content = body.trim()
        break
      }
    }

    if (!content) continue

    const section = [
      `## ${result.title || result.pageId} (${result.pageId})`,
      result.description ? `> ${result.description}` : '',
      '',
      content,
    ].filter((l) => l !== null).join('\n')

    if (usedChars + section.length > charBudget) break

    sections.push(section)
    usedChars += section.length
  }

  if (sections.length === 0) {
    return `No relevant documentation found for "${topic}".`
  }

  return sections.join('\n\n---\n\n')
}
