/** Source-derived anonymous expectations; endpoint output never defines its own smoke oracle. */
import { projectNavigationContract, type NavigationContractConfig } from '@thallylabs/core/navigation'
import { parseFrontmatter } from '../../src/lib/frontmatter'
import { parseReaderAuthConfig } from '../../src/lib/reader-auth/config'
import { ANONYMOUS_READER, canReaderAccessPage, canReaderAccessUnmarkedContent, MALFORMED_PAGE_ACCESS, parsePageAccess } from '../../src/lib/reader-auth/access'
import { SUPPORTED_LOCALE_OPTIONS } from '../../src/lib/i18n/config'

/** Preserve direct-file/index precedence and the normal site default for empty frontmatter. */
export function anonymousSmokeScope(config: NavigationContractConfig & { auth?: unknown; i18n?: { locales?: Array<{ code?: unknown }> }; redirects?: Array<{ source: string; destination: string }> }, sources: Record<string, { content: string }>) {
  const policy = parseReaderAuthConfig(config.auth)
  const navigation = projectNavigationContract(config)
  const locales = new Set(SUPPORTED_LOCALE_OPTIONS.map((locale) => locale.code.toLowerCase()))
  const i18n = config.i18n
  for (const locale of i18n?.locales ?? []) if (typeof locale.code === 'string') locales.add(locale.code.toLowerCase())
  const pageIds = new Set(navigation.authoredPageIds)
  for (const file of Object.keys(sources)) {
    if (!file.startsWith('src/content/') || !file.endsWith('.mdx')) continue
    const relative = file.slice('src/content/'.length, -4)
    if (locales.has(relative.split('/')[0].toLowerCase())) continue
    pageIds.add(relative.endsWith('/index') ? relative.slice(0, -6) : relative)
  }
  const allowed = (id: string) => {
    const file = sources[`src/content/${id}.mdx`] ?? sources[`src/content/${id}/index.mdx`]
    let access = MALFORMED_PAGE_ACCESS
    if (file) {
      try { access = parsePageAccess(parseFrontmatter(file.content).data) } catch { /* Malformed source is closed. */ }
    }
    return canReaderAccessPage(access, ANONYMOUS_READER, policy)
  }
  const publicPageIds = [...pageIds].filter(allowed)
  let rootTarget = '/'
  const visited = new Set<string>()
  while (!visited.has(rootTarget)) {
    visited.add(rootTarget)
    const redirect = config.redirects?.find((redirect) => (redirect.source.replace(/\/$/, '') || '/') === rootTarget)
    if (!redirect) break
    rootTarget = redirect.destination.split(/[?#]/)[0].replace(/\/$/, '') || '/'
  }
  const rootId = rootTarget === '/' || rootTarget === '/introduction' ? 'introduction' : rootTarget.slice(1)
  const isRootPublic = rootTarget !== '/'
    ? rootTarget.startsWith('/') && allowed(rootId)
    : sources['src/content/introduction.mdx'] || sources['src/content/introduction/index.mdx']
      ? allowed('introduction') : navigation.visiblePageIds.some(allowed)
  return {
    publicPageIds,
    publicNavigationIds: navigation.visiblePageIds.filter(allowed),
    protectedPageIds: [...pageIds].filter((id) => !allowed(id)),
    isRootPublic,
    allowsUnmarked: canReaderAccessUnmarkedContent(ANONYMOUS_READER, policy),
  }
}

/** Generated discovery utilities are positive checks; authored prose links are not. */
export function smokeUtilityPaths(body: string, options: { samplePageId?: string; allowsUnmarked: boolean; isRootPublic: boolean }): string[] {
  const origin = body.match(/^- Documentation: (https?:\/\/\S+)$/m)?.[1]
  if (!origin) throw new Error('llms.txt did not advertise its documentation URL.')
  const labels = /^- (Documentation|Full docs for LLMs|Agent discovery \(ai\.txt\)|Structured docs index \(JSON\)|OpenAPI spec|Per-page API|Search API|Capability manifest \(skill\)|Agent guidance \(editing these docs\)|MCP server \(attach docs as native tools\)|Agent readiness|Changelog feed \(JSON Feed\)|Changelog feed \(RSS\)): (https?:\/\/\S+)$/gm
  return [...body.matchAll(labels)].flatMap((match) => {
    if (match[1] === 'Documentation' && !options.isRootPublic) return []
    if (match[1] === 'Per-page API' && !options.samplePageId) return []
    if (['OpenAPI spec', 'Capability manifest (skill)'].includes(match[1]) && !options.allowsUnmarked) return []
    const url = new URL(match[2].replace('{page-id}', options.samplePageId ?? '').replace('{query}', 'Thally'))
    return url.origin === new URL(origin).origin ? [`${url.pathname}${url.search}`] : []
  })
}
