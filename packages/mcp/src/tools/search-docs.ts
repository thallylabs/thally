import { z } from 'zod'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import matter from 'gray-matter'

export const searchDocsSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project root'),
  query: z.string().describe('Search query'),
  limit: z.number().optional().default(5).describe('Max results to return (default 5)'),
})

export type SearchDocsInput = z.infer<typeof searchDocsSchema>

export interface SearchResult {
  pageId: string
  title: string
  description: string
  score: number
}

export function scanMdxFiles(dir: string, results: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        scanMdxFiles(fullPath, results)
      } else if (extname(entry).toLowerCase() === '.mdx') {
        results.push(fullPath)
      }
    } catch {
      // skip
    }
  }
}

export function scoreFiles(files: string[], contentDir: string, query: string): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: SearchResult[] = []

  for (const filePath of files) {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }

    const { data, content } = matter(raw)
    const title = (data.title as string | undefined) ?? ''
    const description = (data.description as string | undefined) ?? ''
    const keywords = (data.keywords as string[] | undefined) ?? []
    const pageId = relative(contentDir, filePath).replace(/\.mdx$/, '').replace(/\\/g, '/')

    let score = 0
    for (const term of terms) {
      if (title.toLowerCase().includes(term)) score += 3
      if (description.toLowerCase().includes(term)) score += 2
      if (keywords.some((k) => k.toLowerCase().includes(term))) score += 2
      const bodyOccurrences = content.toLowerCase().split(term).length - 1
      score += Math.min(bodyOccurrences, 5)
    }

    if (score > 0) {
      results.push({ pageId, title, description, score })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

export async function handleSearchDocs(input: SearchDocsInput): Promise<string> {
  const { projectDir, query, limit = 5 } = input
  const contentDir = join(projectDir, 'src', 'content')

  if (!existsSync(contentDir)) {
    throw new Error(`Content directory not found: ${contentDir}`)
  }

  const files: string[] = []
  scanMdxFiles(contentDir, files)

  const results = scoreFiles(files, contentDir, query).slice(0, limit)

  if (results.length === 0) {
    return `No results found for "${query}".`
  }

  const lines = [`Found ${results.length} result${results.length > 1 ? 's' : ''} for "${query}":\n`]
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title || r.pageId} — ${r.pageId}`)
    if (r.description) lines.push(`   ${r.description}`)
    lines.push('')
  })

  return lines.join('\n').trimEnd()
}
