import { z } from 'zod'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'

export const updatePageSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
  pageId: z.string().describe('Page identifier (e.g. "guides/auth"). No .mdx extension.'),
  title: z.string().optional().describe('New page title'),
  description: z.string().optional().describe('New page description'),
  content: z.string().optional().describe('New MDX body content (replaces existing body)'),
  mergeFrontmatter: z.record(z.unknown()).optional().describe('Additional frontmatter fields to merge in'),
})

export type UpdatePageInput = z.infer<typeof updatePageSchema>

function findPageFile(projectDir: string, pageId: string): string | null {
  const candidates = [
    join(projectDir, 'src', 'content', `${pageId}.mdx`),
    join(projectDir, 'src', 'content', `${pageId}/index.mdx`),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function handleUpdatePage(input: UpdatePageInput): Promise<string> {
  const { projectDir, pageId } = input

  const filePath = findPageFile(projectDir, pageId)
  if (!filePath) {
    throw new Error(
      `Page not found for pageId "${pageId}". Tried:\n` +
      `  src/content/${pageId}.mdx\n` +
      `  src/content/${pageId}/index.mdx`,
    )
  }

  const raw = readFileSync(filePath, 'utf8')
  const parsed = matter(raw)

  // Merge frontmatter
  const newFm: Record<string, unknown> = { ...parsed.data }

  if (input.title !== undefined) newFm['title'] = input.title
  if (input.description !== undefined) newFm['description'] = input.description
  if (input.mergeFrontmatter) {
    Object.assign(newFm, input.mergeFrontmatter)
  }

  // Determine body
  const newBody = input.content !== undefined ? input.content : parsed.content

  // Stringify and write
  const newContent = matter.stringify(newBody.trim(), newFm)
  writeFileSync(filePath, newContent, 'utf8')

  return [
    `✅ Page updated: ${filePath}`,
    `   pageId: ${pageId}`,
    ...(input.title ? [`   title:  ${input.title}`] : []),
    ...(input.description ? [`   description: ${input.description}`] : []),
    ...(input.content !== undefined ? ['   body: replaced'] : []),
  ].join('\n')
}
