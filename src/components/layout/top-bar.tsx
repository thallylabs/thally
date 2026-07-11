'use client'

import type React from 'react'
import Link from 'next/link'
import { Suspense } from 'react'
import { ExternalLink } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import type { SidebarCollection, DocsJsonNavbar } from '@/data/docs'
import type { SearchCorpusRecord } from '@/components/search/command-search'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { CommandSearch } from '@/components/search/command-search'
import { ThemeSwitch } from '@/components/theme/theme-switch'
import { VersionSwitcher } from '@/components/docs/version-switcher'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import type { I18nConfig } from '@/components/layout/site-shell'
import { shell } from '@/config/layout'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/data/site'

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
  searchIndex: Array<SearchCorpusRecord>
  i18nConfig?: I18nConfig | null
  currentLocale?: string
  currentPath?: string
  navbarConfig?: DocsJsonNavbar | null
}

export function TopBar({
  collections,
  activeCollectionId,
  onCollectionChange,
  activeSections,
  searchIndex,
  i18nConfig,
  currentLocale,
  currentPath,
  navbarConfig,
}: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()

  // siteConfig fallbacks (used when navbarConfig is not set)
  const supportLink =
    siteConfig.links.find((link) => {
      const label = link.label.toLowerCase()
      return label.includes('support') || label.includes('contact')
    })
  const siteConfigCta =
    siteConfig.links.find((link) => {
      const label = link.label.toLowerCase()
      return link !== supportLink && (label.includes('get') || label.includes('start') || label.includes('demo'))
    })

  // navbarConfig.primary overrides the siteConfig CTA when present
  const primaryCta = navbarConfig?.primary
    ? { label: navbarConfig.primary.label, href: navbarConfig.primary.href }
    : siteConfigCta

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/80 backdrop-blur">
      <div className={cn('flex flex-col gap-3 py-3 sm:gap-4 sm:py-4', shell.topbar)}>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <MobileNav sections={activeSections} />
          <div className="ml-auto flex w-full flex-1 flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
            <Suspense
              fallback={
                <div className="hidden h-9 flex-1 items-center rounded-[var(--theme-control-radius)] border border-border/40 px-4 sm:h-10 lg:flex" />
              }
            >
              <CommandSearch searchIndex={searchIndex} />
            </Suspense>
            {navbarConfig?.links && navbarConfig.links.length > 0
              ? navbarConfig.links.map((link) => {
                  const isExternal = /^https?:\/\//.test(link.href)
                  const isGithub = link.type === 'github'
                  return (
                    <a
                      key={link.href}
                      href={link.href}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noreferrer' : undefined}
                      className="hidden items-center gap-1.5 rounded-[var(--theme-control-radius)] border border-border/50 px-3 py-1.5 text-xs font-medium text-foreground/70 transition hover:text-foreground sm:inline-flex sm:px-4 sm:py-2 sm:text-sm"
                    >
                      {isGithub ? (
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
                        </svg>
                      ) : (
                        isExternal && <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      {link.label}
                    </a>
                  )
                })
              : supportLink
                ? (
                    <Link
                      href={supportLink.href}
                      className="hidden items-center rounded-[var(--theme-control-radius)] border border-border/50 px-3 py-1.5 text-xs font-medium text-foreground/70 transition hover:text-foreground sm:inline-flex sm:px-4 sm:py-2 sm:text-sm"
                    >
                      <span className="hidden sm:inline">{supportLink.label}</span>
                      <span className="inline sm:hidden">{supportLink.label.split(' ')[0]}</span>
                    </Link>
                  )
                : null}
            {primaryCta ? (
              <Link
                href={primaryCta.href}
                className="inline-flex items-center rounded-[var(--theme-control-radius)] bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow hover:bg-accent/90 sm:px-4 sm:py-2 sm:text-sm"
              >
                <span className="hidden sm:inline">{primaryCta.label}</span>
                <span className="inline sm:hidden">{primaryCta.label.replace('Get ', '')}</span>
              </Link>
            ) : null}
            <VersionSwitcher />
            {i18nConfig && i18nConfig.locales.length >= 2 ? (
              <LocaleSwitcher
                locales={i18nConfig.locales}
                currentLocale={currentLocale ?? i18nConfig.defaultLocale}
                currentPath={currentPath ?? '/'}
                defaultLocale={i18nConfig.defaultLocale}
              />
            ) : null}
            <ThemeSwitch />
          </div>
        </div>
        <div
          className="thally-nav-tab-bar scrollbar-hide -mx-2 flex items-center gap-1.5 overflow-x-auto border border-border/50 bg-muted/20 px-2 py-1 text-xs font-semibold sm:mx-0 sm:gap-2 sm:text-sm rounded-[var(--theme-nav-bar-radius)]"
          style={{ backgroundColor: 'var(--theme-nav-bar-bg)', borderColor: 'var(--theme-nav-bar-border-color)' }}
        >
          {collections.map((collection) => {
            const isActive = collection.id === activeCollectionId
            const baseClasses = cn(
              'thally-nav-tab-item group relative shrink-0 px-3 py-1.5 text-left transition whitespace-nowrap sm:px-4 sm:py-2',
              'rounded-[var(--theme-nav-tab-radius)]',
              isActive
                ? 'thally-nav-tab-active text-foreground'
                : 'text-foreground/70 hover:text-foreground',
            )
            const indicator = (
              <span
                className={cn(
                  'pointer-events-none absolute inset-x-2 bottom-0 h-px rounded-full transition',
                  isActive ? 'bg-accent' : 'bg-transparent group-hover:bg-border/80',
                )}
                style={{ opacity: 'var(--theme-nav-tab-indicator-opacity, 1)' } as React.CSSProperties}
              />
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
                <Link
                  key={collection.id}
                  href={collection.href}
                  className={baseClasses}
                >
                  {indicator}
                  {collection.label}
                </Link>
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
                {indicator}
                {collection.label}
              </button>
            )
          })}
        </div>
      </div>
    </header>
  )
}

