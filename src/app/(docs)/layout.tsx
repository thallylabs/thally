/** Request-bound documentation shell shared by every rendered content route. */

import { SiteShell } from '@/components/layout/site-shell'
import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { loadSidebarCollections, getAiConfig, getNavbarConfig, getFooterConfig } from '@/data/docs'
import type { NavigationSection } from '@/data/docs'
import { buildApiNavigation } from '@/data/api-reference'
import { DocsChatLoader } from '@/components/docs/docs-chat-loader'
import { getBuildI18nConfig } from '@/lib/i18n/request'
import { resolveBuildSiteConfig, siteIdentity } from '@/lib/site-config'

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

  const sidebarCollections = await loadSidebarCollections()
  const collections = sidebarCollections.map((collection) => {
    if (collection.api && collection.api.navigation !== false) {
      // Merge MDX-based sections (from docs.json groups) with OpenAPI-generated sections
      const mdxSections = collection.sections ?? []
      const mergedSections = [...mdxSections, ...apiSections]
      return { ...collection, sections: mergedSections }
    }
    return collection
  })
  const aiConfig = getAiConfig()
  const i18nConfig = getBuildI18nConfig()
  const navbarConfig = getNavbarConfig()
  const footerConfig = getFooterConfig()
  const effectiveSite = resolveBuildSiteConfig()

  return (
    <>
      <SidebarCollectionsHydrator collections={collections} />
      <SiteShell
        initialCollections={collections}
        i18nConfig={i18nConfig}
        navbarConfig={navbarConfig}
        footerConfig={footerConfig}
        identity={siteIdentity(effectiveSite)}
      >
        {children}
      </SiteShell>
      <DocsChatLoader label={aiConfig.label} icon={aiConfig.icon} />
    </>
  )
}
