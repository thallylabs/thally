import { NextResponse } from 'next/server'
import { canReaderViewPage, ensureDocPublication, isDocPublished, isLocaleDirectory } from '@/data/docs'
import { getContentSource } from '@/lib/content-source'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'
import { isMarkdownPagesEnabled } from '@/lib/markdown-pages'
import { markdownMirrorCandidates, renderMarkdownMirror } from '@/lib/markdown-mirror'
import { parseFrontmatter } from '@/lib/frontmatter'
import { getReaderAuthConfig } from '@/lib/reader-auth/config'
import { canReaderAccessPage, parsePageAccess } from '@/lib/reader-auth/access'
import { getReaderContextFromRequest } from '@/lib/reader-auth/context'
import { contentCacheControl } from '@/lib/reader-auth/cache'

const localDocsRoot = 'src/content'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const origin = new URL(request.url).origin
  const cloud = await getCloudSiteConfig(origin)
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
  // A bare locale root (`/es.md`) is that locale's introduction page.
  const localeRoot = slug.length === 1 && isLocaleDirectory(slug[0])
  const pageId = localeRoot ? 'introduction' : slugPath.replace(/\/index$/, '') || 'introduction'
  if (!isDocPublished(pageId)) {
    return new NextResponse('Not Found', { status: 404 })
  }
  // Reader access: a restricted page answers exactly like a missing one.
  const reader = await getReaderContextFromRequest(request)
  if (!(await canReaderViewPage(pageId, reader))) {
    return new NextResponse('Not Found', { status: 404 })
  }
  // `/fr/guide.md` serves the translation file directly; the primary page's
  // rules apply too, so a translation that omits `groups` opens nothing. A
  // bare locale root (`/es.md`) follows the same rule.
  if (localeRoot) {
    if (!(await canReaderViewPage(pageId, reader, slug[0]))) {
      return new NextResponse('Not Found', { status: 404 })
    }
  } else if (slug.length > 1 && isLocaleDirectory(slug[0])) {
    const primaryId = slug.slice(1).join('/').replace(/\/index$/, '') || 'introduction'
    if (!(await canReaderViewPage(primaryId, reader, slug[0]))) {
      return new NextResponse('Not Found', { status: 404 })
    }
  }

  const rootPrefix = `${localDocsRoot}/`
  const mirrorId = localeRoot ? `${slug[0]}/introduction` : slugPath
  const candidates = markdownMirrorCandidates(mirrorId)

  const source = getContentSource()
  for (const filePath of candidates) {
    // Containment: the resolved file must stay inside src/content.
    if (!filePath.startsWith(rootPrefix)) continue
    const file = await source.read(filePath)
    if (file) {
      // The file actually served may differ from the indexed page (a bare
      // `.md` file, say); its own access frontmatter must allow the reader too.
      let fileAccess
      try {
        fileAccess = parsePageAccess(parseFrontmatter(file.content).data)
      } catch {
        // Unparseable frontmatter cannot prove the page is open: fail closed.
        fileAccess = { groupSets: [], isMalformed: true }
      }
      if (!canReaderAccessPage(fileAccess, reader, getReaderAuthConfig())) {
        return new NextResponse('Not Found', { status: 404 })
      }
      // One serializer for the `.md` mirror and the negotiated markdown. The
      // public frontmatter is limited to title and description.
      return new NextResponse(renderMarkdownMirror(file.content, origin), {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Cache-Control': contentCacheControl('public, max-age=300'),
        },
      })
    }
  }

  return new NextResponse('Not Found', { status: 404 })
}
