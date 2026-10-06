import { type NextRequest } from 'next/server'
import { estimateTokens } from '@thallylabs/core/embeddings'
import { getAllApiOperationNodes, type ApiOperationNode } from '@/data/api-reference'
import { loadDocEntries, loadSidebarCollections } from '@/data/docs'
import { loadContentDocument } from '@/lib/content'
import { problemResponse } from '@/lib/http/problem'
import { getEffectiveI18nConfig } from '@/lib/i18n/request'
import { listAgentPages } from '@/lib/mcp/site-tools'
import { apiOperationMarkdown, describeApiOperation } from '@/lib/openapi/operation-projection'
import { resolveRequestSiteConfig } from '@/lib/site-config'

/**
 * `llms-full.txt` — the whole documentation corpus as one Markdown file.
 *
 * Built from the same projections every other agent surface uses, so they
 * cannot disagree:
 * - Pages: the structured content document's agent Markdown
 *   (`content.markdown`), byte-identical to MCP `read_page` and the `.md`
 *   mirrors. `<Visibility for="humans">` / `<Human>` content never appears,
 *   and every MDX component is projected to Markdown (no raw JSX).
 * - Which pages: the search listing (`listAgentPages`), so hidden, noindex
 *   and older-version pages are left out exactly as search leaves them out.
 *   Pages appear in sidebar order, then any indexable page outside the
 *   sidebar.
 * - API operations: the compact operation projection MCP resources use,
 *   after the pages (default locale only; operations are not translated).
 *
 * `?locale=<code>` returns a translated corpus containing only translated
 * pages. `X-Thally-Approx-Tokens` estimates the body size (~4 chars/token)
 * so an agent can decide whether to fetch it whole.
 */
export async function GET(request: NextRequest) {
  // Under the assets ContentSource this route must render per request — the
  // corpus below reflects published content, not the build. No-op by default.
  const effectiveSite = await resolveRequestSiteConfig()
  const baseUrl = request.nextUrl.origin

  const i18n = await getEffectiveI18nConfig()
  const requestedLocale = request.nextUrl.searchParams.get('locale')
  if (requestedLocale && !i18n.locales.some((locale) => locale.code === requestedLocale)) {
    return problemResponse({
      status: 400,
      code: 'invalid_locale',
      title: 'Unsupported language',
      detail: 'The requested locale is not enabled for this site.',
      resolution: 'Use a language code enabled in the site configuration.',
      instance: request.nextUrl.pathname,
    })
  }
  const locale = requestedLocale ?? i18n.defaultLocale
  const engineLocale = locale === i18n.defaultLocale ? undefined : locale

  const [entries, listable, collections, apiNodes] = await Promise.all([
    loadDocEntries(),
    listAgentPages(engineLocale),
    loadSidebarCollections(),
    // An unreachable remote spec must not take the page corpus down with it.
    engineLocale ? Promise.resolve([] as Array<ApiOperationNode>) : getAllApiOperationNodes().catch(() => [] as Array<ApiOperationNode>),
  ])

  // Sidebar items carry default-locale hrefs; map them back to page ids, then
  // keep only pages the search listing includes for this locale.
  const idByHref = new Map(entries.map((entry) => [entry.href, entry.id]))
  const listableById = new Map(listable.map((entry) => [entry.id, entry]))
  const apiNodeByHref = new Map(apiNodes.map((node) => [node.href, node]))

  const pageOrder: Array<string> = []
  const operationOrder: Array<ApiOperationNode> = []
  const seenPages = new Set<string>()
  const seenOperations = new Set<ApiOperationNode>()
  for (const collection of collections) {
    const hrefs = [
      ...(collection.sections.length === 0 && collection.href ? [collection.href] : []),
      ...collection.sections.flatMap((section) => section.items.map((item) => item.href)),
    ]
    for (const href of hrefs) {
      const node = apiNodeByHref.get(href)
      if (node && !seenOperations.has(node)) {
        seenOperations.add(node)
        operationOrder.push(node)
        continue
      }
      const id = idByHref.get(href)
      if (id && listableById.has(id) && !seenPages.has(id)) {
        seenPages.add(id)
        pageOrder.push(id)
      }
    }
  }
  for (const entry of listable) if (!seenPages.has(entry.id)) pageOrder.push(entry.id)
  for (const node of apiNodes) if (!seenOperations.has(node)) operationOrder.push(node)

  const documents = await Promise.all(pageOrder.map((id) => loadContentDocument(id, engineLocale)))

  const lines: Array<string> = []
  lines.push(`# ${effectiveSite.name} — Complete Documentation`)
  lines.push('')
  lines.push(`> ${effectiveSite.description}`)
  lines.push('')
  lines.push(`Source: ${baseUrl}`)
  lines.push(`Language: ${locale}`)
  lines.push('')
  lines.push('## Instructions for agents')
  lines.push('')
  lines.push(`- Use ${baseUrl}/llms.txt to inspect the page index before scanning this full corpus.`)
  lines.push(`- Use ${baseUrl}/skill.md for retrieval rules and ${baseUrl}/AGENTS.md before editing.`)
  lines.push(`- Use ${baseUrl}/api/mcp for read-only search, section retrieval, page, API and changelog tools.`)
  lines.push('- Cite canonical page URLs, distinguish documented facts from inference, and state when the documentation does not support a claim.')
  lines.push('')
  lines.push('---')
  lines.push('')

  pageOrder.forEach((id, index) => {
    const entry = listableById.get(id)
    const document = documents[index]
    if (!entry || !document) return
    lines.push(`# ${entry.title}`)
    lines.push('')
    if (entry.description) {
      lines.push(`> ${entry.description}`)
      lines.push('')
    }
    lines.push(`URL: ${baseUrl}${entry.href}`)
    lines.push('')
    lines.push(document.content.markdown)
    lines.push('')
    lines.push('---')
    lines.push('')
  })

  if (operationOrder.length > 0) {
    lines.push('# API reference')
    lines.push('')
    lines.push(`Full schemas: MCP \`get_api_operation\` at ${baseUrl}/api/mcp, or the human reference pages below.`)
    lines.push('')
    for (const node of operationOrder) {
      lines.push(apiOperationMarkdown(describeApiOperation(node, baseUrl)))
      lines.push('')
    }
  }

  const body = lines.join('\n')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Language': locale,
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Thally-Approx-Tokens': String(estimateTokens(body)),
    },
  })
}
