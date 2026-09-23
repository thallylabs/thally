import { type NextRequest } from 'next/server'
import { getDocEntries, loadDocEntries, loadNavContext } from '@/data/docs'
import { hasDocTranslation } from '@/lib/i18n/translation-source'
import { mdxToMarkdown } from '@thallylabs/core/markdown'
import { loadContentDocument } from '@/lib/content'
import { buildDocPageJsonLd } from '@/lib/json-ld'
import { resolveSiteConfig } from '@/lib/site-config'
import { problemResponse } from '@/lib/http/problem'
import { resolveDocRoute } from '@/lib/i18n/doc-route'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { localizeDocNavigation } from '@/lib/i18n/navigation'
import { localizedPath } from '@/lib/i18n/config'

/** Nearest valid pages for a missing slug, so a 404'd agent can self-correct. */
function suggestSlugs(
  slugPath: string,
  entries: ReturnType<typeof getDocEntries>,
): Array<{ slug: string; href: string }> {
  const target = slugPath.toLowerCase()
  const lastSeg = target.split('/').pop() ?? target
  return entries
    .map((entry) => {
      const slug = entry.slug.join('/')
      const s = slug.toLowerCase()
      const seg = s.split('/').pop() ?? s
      let score = 0
      if (s === target) score += 10
      else if (s && (s.includes(target) || target.includes(s))) score += 5
      if (seg && seg === lastSeg) score += 4
      else if (seg && lastSeg && (seg.includes(lastSeg) || lastSeg.includes(seg))) score += 2
      return { slug, href: entry.href, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ slug, href }) => ({ slug, href }))
}

function resolveRequestedFormat(request: NextRequest): 'json' | 'ldjson' | 'markdown' {
  const formatHeader = request.headers.get('x-thally-format')
  if (formatHeader === 'ldjson') return 'ldjson'
  if (formatHeader === 'json') return 'json'
  if (formatHeader === 'md') return 'markdown'

  const formatParam = request.nextUrl.searchParams.get('format')
  if (formatParam === 'ldjson') return 'ldjson'
  if (formatParam === 'json') return 'json'
  if (formatParam === 'md') return 'markdown'

  const accept = request.headers.get('accept') ?? ''
  if (accept.includes('application/ld+json')) return 'ldjson'
  if (accept.includes('application/json')) return 'json'
  if (accept.includes('text/markdown')) return 'markdown'

  return 'markdown'
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: Array<string> }> },
) {
  const baseUrl = request.nextUrl.origin
  const { slug } = await params
  const i18n = await getEffectiveI18nConfig()
  const route = resolveDocRoute(slug, i18n)
  const slugPath = (route.docSlug ?? []).join('/')
  const format = resolveRequestedFormat(request)
  const wantsJson = format === 'json'
  const wantsLdJson = format === 'ldjson'

  // Find matching doc entry
  const entries = await loadDocEntries()
  const entry = entries.find((e) => e.slug.join('/') === slugPath || e.id === slugPath)

  if (!entry) {
    const suggestions = suggestSlugs(slugPath, entries)
    if (wantsJson || wantsLdJson) {
      return problemResponse({
        status: 404,
        code: 'not_found',
        title: 'Documentation page not found',
        detail: 'No documentation page matches this path.',
        resolution: suggestions.length
          ? 'Retry with one of the suggested page identifiers.'
          : 'Read `/api/docs-index` for the complete list of published page identifiers.',
        instance: request.nextUrl.pathname,
        extensions: {
          docs_index: `${baseUrl}/llms.txt`,
          did_you_mean: suggestions,
        },
      })
    }
    const hint = suggestions.length
      ? `\n\nDid you mean:\n${suggestions.map((s) => `- ${s.href}`).join('\n')}`
      : ''
    return new Response(
      `# 404 — Page not found\n\nNo documentation page matches this path. See ${baseUrl}/llms.txt for the full page index.${hint}`,
      { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
    )
  }

  // Single source of truth — parse the content graph once via the content
  // engine, reading through the active ContentSource so managed content
  // publishes are reflected without a rebuild.
  const hasRequestedTranslation = !route.isLocaleRoute || await hasDocTranslation(route.docSlug, route.locale)
  const document = hasRequestedTranslation
    ? await loadContentDocument(entry.id, route.isLocaleRoute ? route.locale : undefined)
    : null
  if (!document) {
    if (wantsJson || wantsLdJson) {
      return problemResponse({
        status: 404,
        code: 'content_not_found',
        title: 'Documentation content unavailable',
        detail: 'The source file for this page could not be read.',
        resolution: 'Read `/api/docs-index` and retry with another published page identifier.',
        instance: request.nextUrl.pathname,
        extensions: {
          docs_index: `${baseUrl}/llms.txt`,
        },
      })
    }
    return new Response(
      `# 404 — Content not found\n\nThe source file for this page could not be read. See ${baseUrl}/llms.txt for the full page index.`,
      { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
    )
  }

  const { content, frontmatter } = document
  const effectiveSite = await resolveSiteConfig(request.nextUrl.origin)
  const canonicalHref = localizedPath(entry.href, route.locale, i18n.defaultLocale)
  const canonicalUrl = `${baseUrl}${canonicalHref}`
  const locale = route.locale
  const nav = await localizeDocNavigation(await loadNavContext(entry.id), locale, i18n.defaultLocale)
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : entry.title
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : entry.description
  const keywords = Array.isArray(frontmatter.keywords) && frontmatter.keywords.every((item) => typeof item === 'string')
    ? frontmatter.keywords as Array<string>
    : entry.keywords
  const lastUpdated = typeof frontmatter.lastUpdated === 'string' ? frontmatter.lastUpdated : entry.lastUpdated
  const jsonLd = buildDocPageJsonLd({
    siteUrl: baseUrl,
    siteName: effectiveSite.name,
    pageUrl: canonicalUrl,
    id: entry.id,
    title,
    description,
    keywords,
    lastUpdated,
    locale,
    breadcrumb: nav.breadcrumb,
  })

  const commonHeaders: Record<string, string> = {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    Vary: 'Accept, X-Thally-Format',
    Link: `<${canonicalHref}>; rel="canonical", <${canonicalHref}?format=json>; rel="alternate"; type="application/json", <${canonicalHref}?format=ldjson>; rel="alternate"; type="application/ld+json"`,
  }

  // -------------------------------------------------------------------------
  // JSON-LD response
  // -------------------------------------------------------------------------
  if (wantsLdJson) {
    return new Response(JSON.stringify(jsonLd), {
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/ld+json; charset=utf-8',
      },
    })
  }

  // -------------------------------------------------------------------------
  // JSON response — all fields derived from the content graph
  // -------------------------------------------------------------------------
  if (wantsJson) {
    const payload = {
      schema_version: '1',

      // Identity
      id: entry.id,
      url: canonicalUrl,
      canonical_url: canonicalUrl,

      // Content
      title,
      description,
      content: {
        mdx: content.markdown,
        text: content.text,
        code_blocks: content.codeBlocks,
        links: content.links,
      },

      // Structure
      headings: content.headings,
      toc: content.toc,

      // Navigation
      nav: {
        tab: nav.tab,
        group: nav.group,
        prev: nav.prev,
        next: nav.next,
        breadcrumb: nav.breadcrumb,
      },

      // Metadata
      meta: {
        locale,
        keywords,
        badge: entry.badge ?? undefined,
        mode: entry.mode ?? undefined,
        noindex: frontmatter.noindex === true || entry.noindex || undefined,
        lastUpdated: lastUpdated || undefined,
        lastVerified: entry.lastVerified || undefined,
        verifiedVersion: entry.verifiedVersion || undefined,
        timeEstimate: entry.timeEstimate || undefined,
      },

      // schema.org structured data (same payload embedded in HTML pages)
      json_ld: jsonLd,

      // OpenAPI (when this page or its tab has a spec)
      ...(frontmatter.openapi || entry.openapi
        ? {
            openapi: {
              spec_url: '/openapi.yaml',
              ...(entry.openapi ? { operations: [`${entry.openapi.method.toUpperCase()} ${entry.openapi.path}`] } : {}),
            },
          }
        : {}),

      // Freshness
      freshness: {
        as_of: new Date().toISOString(),
        cache_ttl_seconds: 3600,
      },
    }

    return Response.json(payload, {
      headers: commonHeaders,
    })
  }

  // -------------------------------------------------------------------------
  // Markdown response (default — backward compat)
  // -------------------------------------------------------------------------
  const lines: Array<string> = []

  lines.push('---')
  lines.push(`title: ${title}`)
  if (description) lines.push(`description: ${description}`)
  lines.push(`url: ${canonicalUrl}`)
  if (lastUpdated) lines.push(`lastUpdated: ${lastUpdated}`)
  if (entry.lastVerified) lines.push(`lastVerified: ${entry.lastVerified}`)
  if (entry.verifiedVersion) lines.push(`verifiedVersion: ${entry.verifiedVersion}`)
  lines.push('---')
  lines.push('')
  lines.push(`# ${title}`)
  lines.push('')
  if (description) {
    lines.push(description)
    lines.push('')
  }
  // Clean MDX → Markdown so agents asking for text/markdown get real Markdown,
  // not JSX component tags mixed into the prose.
  lines.push(mdxToMarkdown(content.markdown))

  return new Response(lines.join('\n'), {
    headers: {
      ...commonHeaders,
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  })
}
