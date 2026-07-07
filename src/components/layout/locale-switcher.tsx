'use client'

import { useState, useRef, useEffect } from 'react'
import { Globe, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LocaleSwitcherProps {
  locales: Array<{ code: string; label: string }>
  currentLocale: string
  currentPath: string
  defaultLocale: string
}

function hrefFor(code: string, currentPath: string, defaultLocale: string) {
  return code === defaultLocale ? currentPath : `/${code}${currentPath}`
}

export function LocaleSwitcher({ locales, currentLocale, currentPath, defaultLocale }: LocaleSwitcherProps) {
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

  if (locales.length < 2) return null

  const current = locales.find((l) => l.code === currentLocale) ?? locales[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-[var(--theme-control-radius)] border border-border/50 px-3 py-1.5 text-xs font-medium text-foreground/70 transition hover:border-border hover:text-foreground"
        aria-label="Switch language"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-lg">
          {locales.map((locale) => {
            const isCurrent = locale.code === currentLocale
            return (
              <a
                key={locale.code}
                href={hrefFor(locale.code, currentPath, defaultLocale)}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-2 text-sm transition',
                  isCurrent
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                )}
              >
                {locale.label}
                {isCurrent ? <Check className="h-3.5 w-3.5" /> : null}
              </a>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
