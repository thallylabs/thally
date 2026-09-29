/**
 * Pure docs.json navigation projection shared by the runtime, published tools,
 * and generated-starter smoke. Authored references include intentionally hidden
 * groups; visible routes exclude them. Neither projection guesses OpenAPI
 * operation routes, which are generated from the specification at runtime.
 */

export interface NavigationContractGroup {
  pages: Array<string | NavigationContractGroup>
  hidden?: boolean
}

export interface NavigationContractTab {
  tab: string
  href?: string
  hidden?: boolean
  pages?: Array<string | NavigationContractGroup>
  groups?: Array<NavigationContractGroup>
  api?: { navigation?: boolean }
}

export interface NavigationContractConfig {
  tabs: Array<NavigationContractTab>
}

export interface NavigationContract {
  /** Explicit MDX references, including hidden nodes and local href-only tabs. */
  authoredPageIds: Array<string>
  /** Routes exposed in visible navigation, in display order. */
  visiblePageIds: Array<string>
  duplicatePageIds: Array<string>
  emptyTabs: Array<string>
}

/** Map an authored content ID to the route served by the public runtime. */
export function navigationPagePath(pageId: string): string {
  return pageId === 'introduction' ? '/' : `/${pageId}`
}

/** Identify visible routes omitted from a generated page advertisement. */
export function missingNavigationRoutes(
  contract: NavigationContract,
  advertisedPaths: Iterable<string>,
): Array<string> {
  const advertised = new Set(advertisedPaths)
  return contract.visiblePageIds
    .map(navigationPagePath)
    .filter((path) => !advertised.has(path))
}

function localHrefPageId(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null
  const path = href.split(/[?#]/, 1)[0].replace(/\/$/, '')
  return path === '' ? 'introduction' : path.slice(1)
}

/**
 * Project only routes that docs.json can establish without reading MDX or an
 * OpenAPI specification. A hidden node still references its authored page,
 * while a protocol-relative or external href never becomes a content page.
 */
export function projectNavigationContract(config: NavigationContractConfig): NavigationContract {
  const authoredPageIds: Array<string> = []
  const visiblePageIds: Array<string> = []
  const duplicatePageIds: Array<string> = []
  const emptyTabs: Array<string> = []
  const authored = new Set<string>()
  const visible = new Set<string>()
  const duplicates = new Set<string>()

  const add = (pageId: string, isVisible: boolean, isNode: boolean) => {
    if (authored.has(pageId)) {
      if (isNode && !duplicates.has(pageId)) {
        duplicates.add(pageId)
        duplicatePageIds.push(pageId)
      }
    } else {
      authored.add(pageId)
      authoredPageIds.push(pageId)
    }
    if (isVisible && !visible.has(pageId)) {
      visible.add(pageId)
      visiblePageIds.push(pageId)
    }
  }

  const visit = (nodes: Array<string | NavigationContractGroup>, isVisible: boolean) => {
    for (const node of nodes) {
      if (typeof node === 'string') add(node, isVisible, true)
      else visit(node.pages, isVisible && !node.hidden)
    }
  }

  for (const tab of config.tabs) {
    const hasNodes = Boolean(tab.pages?.length || tab.groups?.length)
    const isVisible = !tab.hidden
    visit(tab.pages ?? [], isVisible)
    visit(tab.groups ?? [], isVisible)

    // A standalone local href (notably Changelog) is a real MDX reference.
    // An API-only tab may point at a generated endpoint instead.
    if (!hasNodes && tab.href && !tab.api) {
      const pageId = localHrefPageId(tab.href)
      if (pageId) add(pageId, isVisible, false)
    }

    if (!hasNodes && !tab.href && !(tab.api && tab.api.navigation !== false) && !tab.hidden) {
      emptyTabs.push(tab.tab)
    }
  }

  return { authoredPageIds, visiblePageIds, duplicatePageIds, emptyTabs }
}
