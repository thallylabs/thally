/** Request-bound documentation shell shared by every rendered content route. */

import { SiteShell } from '@/components/layout/site-shell'
import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { getSidebarCollections, getAiConfig, getI18nConfig, getNavbarConfig, getFooterConfig } from '@/data/docs'
import type { NavigationSection } from '@/data/docs'
import { getClientSearchCorpus } from '@/lib/search/corpus'
import { buildApiNavigation } from '@/data/api-reference'
import { DocsChat } from '@/components/docs/docs-chat'
import { isAiChatAvailable } from '@/lib/cloud-bridge'
import { getRequestCloudSiteConfig, getRequestOrigin } from '@/lib/cloud-link/request'

// The docs shell resolves request-bound Cloud configuration and origin data.
// Marking that contract explicitly keeps OpenNext from attempting a static
// render that fails only on non-root routes with DYNAMIC_SERVER_USAGE.
export const dynamic = 'force-dynamic'

interface DocsLayoutProps {
  children: React.ReactNode
}

export default async function DocsLayout({ children }: DocsLayoutProps) {
  const navigation = await buildApiNavigation()
  const apiSections: Array<NavigationSection> = navigation.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      id: item.id,
      title: item.title,
      href: item.href,
      badge: item.badge,
      description: `${item.method} ${item.path}`,
    })),
  }))

  const sidebarCollections = getSidebarCollections()
  const collections = sidebarCollections.map((collection) => {
    if (collection.api && collection.api.navigation !== false) {
      // Merge MDX-based sections (from docs.json groups) with OpenAPI-generated sections
      const mdxSections = collection.sections ?? []
      const mergedSections = [...mdxSections, ...apiSections]
      return { ...collection, sections: mergedSections }
    }
    return collection
  })
  const searchIndex = getClientSearchCorpus()
  const aiConfig = getAiConfig()
  const i18nConfig = getI18nConfig()
  const navbarConfig = getNavbarConfig()
  const footerConfig = getFooterConfig()
  const origin = await getRequestOrigin()
  // Resolve settings first so linked sites reuse the same cached short-lived
  // grant when checking the paid AI service immediately afterward.
  const cloudConfig = await getRequestCloudSiteConfig()
  const hasAiService = await isAiChatAvailable(origin)
  const isAiEnabled = cloudConfig
    ? Boolean(cloudConfig.entitlements.features?.aiAnswers) &&
      Boolean(cloudConfig.siteConfig.portable.ai?.enabled)
    : Boolean(aiConfig.chat)

  return (
    <>
      <SidebarCollectionsHydrator collections={collections} />
      <SiteShell
        initialCollections={collections}
        searchIndex={searchIndex}
        i18nConfig={i18nConfig}
        navbarConfig={navbarConfig}
        footerConfig={footerConfig}
      >
        {children}
      </SiteShell>
      {isAiEnabled && (
        <DocsChat label={aiConfig.label} icon={aiConfig.icon} enabled={hasAiService} />
      )}
    </>
  )
}
