'use client'

/** Keyboard-accessible locale navigation remains available in compact headers. */

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Check, ChevronDown, Languages } from 'lucide-react'
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

/** Switch locale without losing the current document path. */
export function LocaleSwitcher({ locales, currentLocale, currentPath, defaultLocale }: LocaleSwitcherProps) {
  if (locales.length < 2) return null
  const currentLabel = locales.find((locale) => locale.code === currentLocale)?.label ?? currentLocale

  return (
    <Menu as="div" className="thally-docs-language relative shrink-0">
      <MenuButton
        className="flex h-[34px] items-center gap-1.5 rounded-[9px] px-2.5 text-[0.88rem] font-medium text-foreground/70 transition hover:bg-muted hover:text-foreground"
        aria-label="Switch language"
        title={currentLabel}
      >
        <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="thally-docs-language-label max-w-32 truncate">{currentLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </MenuButton>

      <MenuItems anchor="bottom start" className="z-50 max-h-[min(28rem,70dvh)] min-w-[160px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border/60 bg-background text-foreground shadow-lg [--anchor-gap:8px]">
        {locales.map((locale) => {
          const isCurrent = locale.code === currentLocale
          return (
            <MenuItem key={locale.code}>
              <a
                href={hrefFor(locale.code, currentPath, defaultLocale)}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-between gap-3 px-4 py-2 text-sm transition-colors data-[focus]:bg-muted',
                  isCurrent
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                )}
              >
                {locale.label}
                {isCurrent ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </a>
            </MenuItem>
          )
        })}
      </MenuItems>
    </Menu>
  )
}
