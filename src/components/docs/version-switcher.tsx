'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { siteConfig } from '@/data/site'
import type { DocsNavigationVersion } from '@/data/docs'
import { cn } from '@/lib/utils'

interface VersionSwitcherProps {
  versions?: Array<DocsNavigationVersion>
  activeLabel?: string
}

/** Prefer request-bound docs.json versions; legacy site.ts versions remain supported. */
export function VersionSwitcher({ versions: configured, activeLabel }: VersionSwitcherProps = {}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const versions = configured ?? siteConfig.versions
  if (!versions || versions.length < 2) return null

  const current = versions.find((version) => version.label === activeLabel)
    ?? versions.find((version) => ('default' in version && version.default) || ('current' in version && version.current))
    ?? versions[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium text-foreground/70 transition hover:bg-muted hover:text-foreground"
      >
        {current.label}
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[140px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-lg">
          {versions.map((version) => {
            const isExternal = version.href.startsWith('http')
            const isCurrent = version === current

            return (
              <a
                key={version.label}
                href={version.href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noreferrer' : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-2 text-sm transition',
                  isCurrent
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                )}
              >
                {version.label}
                {isCurrent ? <Check className="h-3.5 w-3.5" /> : null}
              </a>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
