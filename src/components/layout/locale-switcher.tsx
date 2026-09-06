'use client'

import { useState, useRef, useEffect } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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
  const currentLabel = locales.find((locale) => locale.code === currentLocale)?.label ?? currentLocale

  return (
    <div ref={ref} className="thally-docs-language relative -ml-2 mr-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-[34px] items-center gap-1.5 rounded-[9px] px-2.5 text-[0.88rem] font-medium text-foreground/70 transition hover:bg-muted hover:text-foreground"
        aria-label="Switch language"
      >
        <span>{currentLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-border/60 bg-background shadow-lg">
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
