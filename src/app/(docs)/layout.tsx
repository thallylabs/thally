import { SiteShell } from '@/components/layout/site-shell'
import { SidebarCollectionsHydrator } from '@/components/layout/sidebar-hydrator'
import { getSidebarCollections, getAiConfig, getI18nConfig, getNavbarConfig, getFooterConfig } from '@/data/docs'
import type { NavigationSection } from '@/data/docs'
import { getClientSearchCorpus } from '@/lib/search/corpus'
import { buildApiNavigation } from '@/data/api-reference'
import { DocsChat } from '@/components/docs/docs-chat'
import { getCloud } from '@/lib/cloud-bridge'

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
    if (collection.api) {
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
      {aiConfig.chat && <DocsChat label={aiConfig.label} icon={aiConfig.icon} enabled={Boolean(getCloud()?.ai?.isChatConfigured())} />}
    </>
  )
}

