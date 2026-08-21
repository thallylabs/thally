'use client'

import { ExternalLink, Sparkles } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import type { SidebarCollection, DocsJsonNavbar } from '@/data/docs'
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

function matchesPath(targetHref: string, pathname: string) {
  if (!targetHref || /^https?:\/\//i.test(targetHref)) {
    return false
  }
  const normalize = (value: string) => {
    if (!value) return '/'
    if (value === '/') return '/'
    return value.endsWith('/') ? value.slice(0, -1) : value
  }
  const normalizedTarget = normalize(targetHref)
  const normalizedPath = normalize(pathname)
  if (normalizedTarget === '/') {
    return normalizedPath === '/'
  }
  return normalizedPath === normalizedTarget || normalizedPath.startsWith(`${normalizedTarget}/`)
}

interface TopBarProps {
  collections: Array<SidebarCollection>
  activeCollectionId: SidebarCollection['id']
  onCollectionChange: (id: SidebarCollection['id']) => void
  activeSections: SidebarCollection['sections']
  i18nConfig?: I18nConfig | null
  currentLocale?: string
  currentPath?: string
  navbarConfig?: DocsJsonNavbar | null
  siteLinks: Array<SiteLink>
}

export function TopBar({
  collections,
  activeCollectionId,
  onCollectionChange,
  activeSections,
  i18nConfig,
  currentLocale,
  currentPath,
  navbarConfig,
  siteLinks,
}: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
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
  const visibleLinkCount = navbarConfig?.links?.length ?? (supportLink ? 1 : 0)
  // Preserve the generous default search affordance for typical documentation
  // sites. Only dense, highly customized navbars opt into the compact layout.
  const isCrowded = collections.length + visibleLinkCount + (primaryCta ? 1 : 0) >= 8

  return (
    <header className="thally-docs-topbar sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
      <div
        className={cn('thally-docs-topbar-inner flex h-14 items-center gap-3', shell.topbar)}
        data-density={isCrowded ? 'compact' : 'comfortable'}
      >
        <MobileNav sections={activeSections} />
        {/* The brand block needs clear separation from the section tabs or
            "Docs" reads as the first tab; mr-5 marks where the brand ends. */}
        <IntentPrefetchLink
          href="/"
          className="thally-docs-brand mr-5 flex shrink-0 items-center gap-2 text-foreground"
        >
          <Logo showText={false} className="shrink-0" />
          <span className="font-heading text-[1rem] font-bold tracking-[-0.015em]">
            {displaySiteName(siteName)}
          </span>
          <span className="-ml-1 font-heading text-[1rem] font-medium text-foreground/55">Docs</span>
        </IntentPrefetchLink>
        <nav className="thally-docs-tabs flex h-full items-center gap-[17px]" aria-label="Documentation sections">
          {collections.map((collection) => {
            const isActive = collection.id === activeCollectionId
            const baseClasses = cn(
              'thally-nav-tab-item group relative flex h-full shrink-0 items-center whitespace-nowrap border-b-[1.5px] px-0 pt-px text-left text-[0.88rem] font-medium transition',
              isActive
                ? 'thally-nav-tab-active border-foreground font-semibold text-foreground'
                : 'border-transparent text-foreground/60 hover:text-foreground',
            )
            if (collection.href) {
              const isExternal = /^https?:\/\//.test(collection.href)
              if (isExternal) {
                return (
                  <a
                    key={collection.id}
                    href={collection.href}
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
                  href={collection.href}
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
                onClick={() => {
                  const targetHref = collection.href
                  const alreadyActive = targetHref ? matchesPath(targetHref, pathname) : false
                  onCollectionChange(collection.id)
                  if (!alreadyActive && targetHref && !matchesPath(targetHref, pathname)) {
                    router.push(targetHref)
                  }
                }}
                className={baseClasses}
              >
                {collection.label}
              </button>
            )
          })}
        </nav>
        <div className="thally-docs-actions ml-auto flex min-w-0 items-center gap-2">
          <div className="thally-docs-search min-w-0">
            <CommandSearch />
          </div>
          {hasAssistantEntryPoint ? (
            <button
              type="button"
              aria-label={assistantActionLabel}
              aria-keyshortcuts="Meta+I Control+I"
              className="thally-docs-assistant-trigger inline-flex h-[30px] shrink-0 items-center gap-2 rounded-full border border-transparent bg-muted/55 px-3 text-[0.84rem] font-semibold text-foreground/80 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={openAssistant}
            >
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{assistantActionLabel}</span>
              <kbd className="thally-docs-assistant-shortcut rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.66rem] font-medium text-foreground/60">
                ⌘I
              </kbd>
            </button>
          ) : null}
          {navbarConfig?.links && navbarConfig.links.length > 0
            ? navbarConfig.links.map((link) => {
                const isExternal = /^https?:\/\//.test(link.href)
                const isGithub = link.type === 'github'
                return (
                  <a key={link.href} href={link.href} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noreferrer' : undefined} data-topbar-link className="thally-docs-topbar-link inline-flex items-center gap-1.5 whitespace-nowrap text-[0.86rem] font-medium text-foreground/70 transition hover:text-foreground">
                    {isGithub ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" /></svg>
                    ) : isExternal ? <ExternalLink className="h-3.5 w-3.5" /> : null}
                    <span>{link.label}</span>
                  </a>
                )
              })
            : supportLink ? (
                <IntentPrefetchLink href={supportLink.href} className="thally-docs-topbar-link hidden whitespace-nowrap text-[0.86rem] font-medium text-foreground/70 hover:text-foreground sm:inline-flex">{supportLink.label}</IntentPrefetchLink>
              ) : null}
          {primaryCta ? (
            <IntentPrefetchLink href={primaryCta.href} className="thally-docs-primary inline-flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-[9px] bg-primary px-3 text-[0.84rem] font-semibold text-primary-foreground transition hover:brightness-125 active:scale-[0.98]">{primaryCta.label}</IntentPrefetchLink>
          ) : null}
          <VersionSwitcher />
          {i18nConfig && i18nConfig.locales.length >= 2 ? (
            <LocaleSwitcher locales={i18nConfig.locales} currentLocale={currentLocale ?? i18nConfig.defaultLocale} currentPath={currentPath ?? '/'} defaultLocale={i18nConfig.defaultLocale} />
          ) : null}
          <ThemeSwitch />
        </div>
      </div>
    </header>
  )
}
