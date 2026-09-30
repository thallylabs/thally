import { NextResponse } from 'next/server'
import { ensureDocPublication, isDocPublished } from '@/data/docs'
import path from 'node:path'
import { stripInternalFrontmatter } from '@/lib/provenance'
import { getContentSource } from '@/lib/content-source'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'
import { isMarkdownPagesEnabled } from '@/lib/markdown-pages'
import { mdxToMarkdown } from '@thallylabs/core/markdown'

const localDocsRoot = 'src/content'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const cloud = await getCloudSiteConfig(new URL(request.url).origin)
  if (!isMarkdownPagesEnabled(cloud?.siteConfig.portable)) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const { slug } = await params
  const slugPath = slug.join('/')

  // Reject any path traversal outright (defense-in-depth beyond Next's routing).
  if (slug.some((seg) => seg === '..' || seg.includes('\0'))) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // The HTML page 404s when its documented OpenAPI operation is hidden or
  // excluded; its Markdown mirror must not publish it either.
  await ensureDocPublication()
  if (!isDocPublished(slugPath.replace(/\/index$/, '') || 'introduction')) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const rootPrefix = `${localDocsRoot}/`
  const candidates = [
    path.posix.join(localDocsRoot, `${slugPath}.mdx`),
    path.posix.join(localDocsRoot, `${slugPath}.md`),
    path.posix.join(localDocsRoot, `${slugPath}/index.mdx`),
  ]

  const source = getContentSource()
  for (const filePath of candidates) {
    // Containment: the resolved file must stay inside src/content.
    if (!filePath.startsWith(rootPrefix)) continue
    const file = await source.read(filePath)
    if (file) {
      // Strip internal provenance frontmatter so it never ships publicly, then
      // clean the MDX body to real Markdown (JSX components → Markdown) while
      // preserving the public frontmatter block.
      const stripped = stripInternalFrontmatter(file.content)
      const frontmatter = stripped.match(/^\s*---\n[\s\S]*?\n---\n?/)?.[0] ?? ''
      const body = mdxToMarkdown(stripped.slice(frontmatter.length))
      return new NextResponse(frontmatter + body, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      })
    }
  }

  return new NextResponse('Not Found', { status: 404 })
}
