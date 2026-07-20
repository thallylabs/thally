/** Render canonical migration bundles into a portable Thally repository tree. */

import type {
  MigrationBundle,
  MigrationDocsConfig,
  MigrationNavigationGroup,
  RenderedMigrationFile,
} from './types.js'

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, ' ').trim())
}

function renderPage(bundle: MigrationBundle, page: MigrationBundle['pages'][number]): string {
  return [
    '---',
    `title: ${yamlString(page.title)}`,
    `description: ${yamlString(page.description)}`,
    page.keywords.length > 0 ? `keywords: [${page.keywords.map(yamlString).join(', ')}]` : null,
    bundle.sourceKind === 'url' ? `source: ${yamlString(page.source)}` : null,
    '---',
    '',
    page.body,
    '',
  ].filter((line) => line !== null).join('\n')
}

/** Merge imported tabs into an existing site without duplicating changelog tabs. */
export function mergeMigrationConfig(
  existing: MigrationDocsConfig,
  incoming: MigrationDocsConfig,
): MigrationDocsConfig {
  const tabs = existing.tabs.filter((tab) => tab.tab.toLowerCase() !== 'changelog')
  const names = new Set(tabs.map((tab) => tab.tab.toLowerCase()))
  const seenPages = new Set<string>()
  function recordPages(groups: MigrationDocsConfig['tabs'][number]['groups']): void {
    for (const group of groups ?? []) {
      for (const page of group.pages) {
        if (typeof page === 'string') seenPages.add(page)
        else recordPages([page])
      }
    }
  }
  for (const tab of tabs) recordPages(tab.groups)
  function uniqueGroups(
    groups: Array<MigrationNavigationGroup> | undefined,
  ): Array<MigrationNavigationGroup> {
    return (groups ?? []).flatMap<MigrationNavigationGroup>((group) => {
      const pages = group.pages.flatMap<string | MigrationNavigationGroup>((page) => {
        if (typeof page === 'string') {
          if (seenPages.has(page)) return []
          seenPages.add(page)
          return [page]
        }
        const [nested]: Array<MigrationNavigationGroup> = uniqueGroups([page])
        return nested ? [nested] : []
      })
      return pages.length > 0 ? [{ ...group, pages }] : []
    })
  }
  for (const tab of incoming.tabs) {
    if (tab.tab.toLowerCase() === 'changelog') continue
    const uniqueTab = { ...tab, ...(tab.groups ? { groups: uniqueGroups(tab.groups) } : {}) }
    if (tab.groups && uniqueTab.groups?.length === 0 && !tab.href && !tab.api) continue
    if (!names.has(tab.tab.toLowerCase())) {
      tabs.push(uniqueTab)
      names.add(tab.tab.toLowerCase())
      continue
    }
    const target = tabs.find((item) => item.tab.toLowerCase() === tab.tab.toLowerCase())
    if (!target || !uniqueTab.groups) continue
    target.groups = [...(target.groups ?? []), ...uniqueTab.groups]
  }
  const changelog = existing.tabs.find((tab) => tab.tab.toLowerCase() === 'changelog')
    ?? incoming.tabs.find((tab) => tab.tab.toLowerCase() === 'changelog')
  if (changelog) tabs.push(changelog)
  const i18n = existing.i18n || incoming.i18n
    ? {
        defaultLocale: existing.i18n?.defaultLocale ?? incoming.i18n?.defaultLocale ?? 'en',
        locales: [...new Map(
          [...(existing.i18n?.locales ?? []), ...(incoming.i18n?.locales ?? [])]
            .map((locale) => [locale.code, locale]),
        ).values()],
      }
    : undefined
  return {
    ...incoming,
    ...existing,
    tabs,
    ...(i18n ? { i18n } : {}),
  }
}

/** Materialize every canonical page, asset, and config as repository file changes. */
export function renderMigrationFiles(
  bundle: MigrationBundle,
  options: { existingConfig?: MigrationDocsConfig } = {},
): Array<RenderedMigrationFile> {
  const config = options.existingConfig
    ? mergeMigrationConfig(options.existingConfig, bundle.docsConfig)
    : bundle.docsConfig
  return [
    ...bundle.pages.map((page) => ({
      path: `src/content/${page.id}.mdx`,
      content: renderPage(bundle, page),
    })),
    ...bundle.assets.map((asset) => ({ path: `public/${asset.path}`, content: asset.content })),
    { path: 'docs.json', content: `${JSON.stringify(config, null, 2)}\n` },
  ]
}
