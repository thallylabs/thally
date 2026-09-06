'use client'

import { ExternalLink, Sparkles } from 'lucide-react'
import type { SidebarCollection, DocsJsonNavbar, NavigationPresentation } from '@/data/docs'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { CommandSearch } from '@/components/search/command-search'
import { ThemeSwitch } from '@/components/theme/theme-switch'
import { VersionSwitcher } from '@/components/docs/version-switcher'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import type { I18nConfig } from '@/components/layout/site-shell'
import { shell } from '@/config/layout'
import { cn } from '@/lib/utils'
import type { SiteLink } from '@/data/site'
import { Logo } from '@/components/layout/logo'
import { displaySiteName, useSiteName } from '@/components/layout/use-site-name'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'
import { useDocsCodeActions } from '@/components/docs/code-actions-provider'

interface TopBarProps {
  collections: Array<SidebarCollection>
  activeCollectionId: SidebarCollection['id']
  onCollectionChange: (id: SidebarCollection['id']) => void
  activeSections: SidebarCollection['sections']
  navigationPresentation: NavigationPresentation
  i18nConfig?: I18nConfig | null
  currentLocale?: string
  currentPath?: string
  navbarConfig?: DocsJsonNavbar | null
  siteLinks: Array<SiteLink>
  showSidebarGroupIcons?: boolean
}

export function TopBar({
  collections,
  activeCollectionId,
  onCollectionChange,
  activeSections,
  navigationPresentation,
  i18nConfig,
  currentLocale,
  currentPath,
  navbarConfig,
  siteLinks,
  showSidebarGroupIcons = true,
}: TopBarProps) {
  const siteName = useSiteName()
  const {
    hasAssistantEntryPoint,
    assistantLabel,
    openAssistant,
  } = useDocsCodeActions()
  const assistantActionLabel = /^ask\b/i.test(assistantLabel)
    ? assistantLabel
    : `Ask ${assistantLabel}`

  // Request-bound site fallbacks (used when navbarConfig is not set).
  const supportLink =
    siteLinks.find((link) => {
      const label = link.label.toLowerCase()
      return label.includes('support') || label.includes('contact')
    })
  const siteConfigCta =
    siteLinks.find((link) => {
      const label = link.label.toLowerCase()
      return link !== supportLink && (label.includes('get') || label.includes('start') || label.includes('demo'))
    })

  // navbarConfig.primary overrides the siteConfig CTA when present
  const primaryCta = navbarConfig?.primary
    ? { label: navbarConfig.primary.label, href: navbarConfig.primary.href }
    : siteConfigCta
  // GitHub is part of the footer's social cluster in the default docs shell.
  // SiteShell carries legacy navbar-only GitHub links into the footer so an
  // existing site does not lose its repository destination during upgrade.
  const navbarLinks = navbarConfig?.links?.filter((link) => link.type !== 'github') ?? []
  const visibleLinkCount = navbarConfig?.links ? navbarLinks.length : (supportLink ? 1 : 0)
  // Preserve the generous default search affordance for typical documentation
  // sites. Only dense, highly customized navbars opt into the compact layout.
  const visibleCollectionCount = navigationPresentation.display === 'tabs' ? collections.length : 0
  const isCrowded = visibleCollectionCount + visibleLinkCount + (primaryCta ? 1 : 0) >= 8

  return (
    <header className="thally-docs-topbar sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
      <div
        className={cn('thally-docs-topbar-inner flex h-[60px] items-center gap-3', shell.topbar)}
        data-density={isCrowded ? 'compact' : 'comfortable'}
      >
        <MobileNav
          sections={activeSections}
          collections={collections}
          activeCollectionId={activeCollectionId}
          onCollectionChange={onCollectionChange}
          showGroupIcons={showSidebarGroupIcons}
        />
        {/* The brand block needs clear separation from the section tabs or
            "Docs" reads as the first tab; mr-5 marks where the brand ends. */}
        <IntentPrefetchLink
          href="/"
          className="thally-docs-brand mr-5 flex shrink-0 items-center gap-2 text-foreground"
        >
          <Logo showText={false} className="shrink-0" />
          <span className="font-heading text-[1rem] font-semibold tracking-[-0.015em]">
            {displaySiteName(siteName)}
          </span>
          <span className="-ml-1 font-heading text-[1rem] font-medium text-foreground/55">Docs</span>
        </IntentPrefetchLink>
        {i18nConfig && i18nConfig.locales.length >= 2 ? (
          <LocaleSwitcher locales={i18nConfig.locales} currentLocale={currentLocale ?? i18nConfig.defaultLocale} currentPath={currentPath ?? '/'} defaultLocale={i18nConfig.defaultLocale} />
        ) : null}
        {navigationPresentation.display === 'tabs' ? (
          <nav className="thally-docs-tabs flex h-full items-center gap-4" aria-label="Documentation sections">
            {collections.map((collection) => {
              const isActive = collection.id === activeCollectionId
              const destination = collection.href ?? collection.sections[0]?.items[0]?.href
              const baseClasses = cn(
                'thally-nav-tab-item group relative flex h-full shrink-0 items-center whitespace-nowrap border-b-2 px-[11px] pt-px text-left text-[0.88rem] font-medium transition',
                isActive
                  ? 'thally-nav-tab-active border-foreground font-semibold text-foreground'
                  : 'border-transparent text-foreground/60 hover:text-foreground',
              )
              if (destination) {
                const isExternal = /^https?:\/\//.test(destination)
                if (isExternal) {
                  return (
                    <a
                      key={collection.id}
                      href={destination}
                      target="_blank"
                      rel="noreferrer"
                      className={baseClasses}
                    >
                      {collection.label}
                    </a>
                  )
                }
                return (
                  <IntentPrefetchLink
                    key={collection.id}
                    href={destination}
                    onClick={() => onCollectionChange(collection.id)}
                    className={baseClasses}
                  >
                    {collection.label}
                  </IntentPrefetchLink>
                )
              }
              return (
                <button
                  key={collection.id}
                  type="button"
                  onClick={() => onCollectionChange(collection.id)}
                  className={baseClasses}
                >
                  {collection.label}
                </button>
              )
            })}
          </nav>
        ) : null}
        <div className="thally-docs-actions ml-auto flex shrink-0 items-center gap-2">
          <div className="thally-docs-search shrink-0">
            <CommandSearch />
          </div>
          {hasAssistantEntryPoint ? (
            <button
              type="button"
              aria-label={assistantActionLabel}
              aria-keyshortcuts="Meta+I Control+I"
              className="thally-docs-assistant-trigger inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[0.84rem] font-semibold text-foreground/80 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={openAssistant}
            >
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{assistantActionLabel}</span>
            </button>
          ) : null}
          {hasAssistantEntryPoint ? (
            <span className="thally-docs-action-divider h-5 w-px bg-border" aria-hidden="true" />
          ) : null}
          {navbarConfig?.links
            ? navbarLinks.map((link) => {
                const isExternal = /^https?:\/\//.test(link.href)
                return (
                  <a key={link.href} href={link.href} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noreferrer' : undefined} aria-label={link.label} title={link.label} data-topbar-link className="thally-docs-topbar-link inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2 text-[0.86rem] font-medium text-foreground/70 transition hover:bg-muted hover:text-foreground">
                    {isExternal ? <ExternalLink className="h-3.5 w-3.5" /> : null}
                    <span>{link.label}</span>
                  </a>
                )
              })
            : supportLink ? (
                <IntentPrefetchLink href={supportLink.href} className="thally-docs-topbar-link hidden whitespace-nowrap text-[0.86rem] font-medium text-foreground/70 hover:text-foreground sm:inline-flex">{supportLink.label}</IntentPrefetchLink>
              ) : null}
          <VersionSwitcher />
          <ThemeSwitch />
          {primaryCta ? (
            <IntentPrefetchLink href={primaryCta.href} className="thally-docs-primary inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-[10px] bg-primary px-[15px] text-[0.84rem] font-semibold text-primary-foreground transition hover:brightness-110 active:scale-[0.98]">{primaryCta.label}</IntentPrefetchLink>
          ) : null}
        </div>
      </div>
    </header>
  )
}
