import { NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { stripInternalFrontmatter } from '@/lib/provenance'
import { mdxToMarkdown } from '@thallylabs/core'

const localDocsRoot = path.join(process.cwd(), 'src/content')

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params
  const slugPath = slug.join('/')

  // Reject any path traversal outright (defense-in-depth beyond Next's routing).
  if (slug.some((seg) => seg === '..' || seg.includes('\0'))) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const rootPrefix = path.resolve(localDocsRoot) + path.sep
  const candidates = [
    path.join(localDocsRoot, `${slugPath}.mdx`),
    path.join(localDocsRoot, `${slugPath}.md`),
    path.join(localDocsRoot, `${slugPath}/index.mdx`),
  ]

  for (const filePath of candidates) {
    // Containment: the resolved file must stay inside src/content.
    if (!path.resolve(filePath).startsWith(rootPrefix)) continue
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      // Strip internal provenance frontmatter so it never ships publicly, then
      // clean the MDX body to real Markdown (JSX components → Markdown) while
      // preserving the public frontmatter block.
      const stripped = stripInternalFrontmatter(raw)
      const frontmatter = stripped.match(/^\s*---\n[\s\S]*?\n---\n?/)?.[0] ?? ''
      const body = mdxToMarkdown(stripped.slice(frontmatter.length))
      return new NextResponse(frontmatter + body, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      })
    } catch {
      // file not found — try next candidate
    }
  }

  return new NextResponse('Not Found', { status: 404 })
}
