import path from 'node:path'
import { mdxToMarkdown } from '@thallylabs/core/markdown'
import { parseFrontmatter, stringifyFrontmatter } from '@/lib/frontmatter'

const ROOT = 'src/content'

/**
 * Physical lookup order for a page's raw source file. Shared by the `.md`
 * mirror and the negotiated markdown route so both read the same bytes.
 */
export function markdownMirrorCandidates(pageId: string): Array<string> {
  if (!pageId || pageId.includes('\0')) return []
  if (pageId.split('/').some((segment) => segment === '..')) return []
  return [
    path.posix.join(ROOT, `${pageId}.mdx`),
    path.posix.join(ROOT, `${pageId}.md`),
    path.posix.join(ROOT, `${pageId}/index.mdx`),
  ]
}

/**
 * Render the public Markdown mirror. The frontmatter is deliberately limited
 * to the two fields an agent needs to identify and summarize the page. UI and
 * navigation keys stay out of the machine projection. Every response starts
 * with a pointer to the full documentation index.
 */
export function renderMarkdownMirror(raw: string, origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const pointer = `> For the full documentation index, see [llms.txt](${base}/llms.txt).\n\n`
  let data: Record<string, unknown>
  let body: string
  try {
    const parsed = parseFrontmatter(raw)
    data = parsed.data
    body = parsed.content
  } catch {
    // Malformed frontmatter cannot be projected safely. Fall back to the body.
    return `${pointer}${mdxToMarkdown(raw)}`
  }

  const frontmatter: Record<string, unknown> = {}
  if (typeof data.title === 'string') frontmatter.title = data.title
  if (typeof data.description === 'string') frontmatter.description = data.description
  return stringifyFrontmatter(`${pointer}${mdxToMarkdown(body)}`, frontmatter)
}
