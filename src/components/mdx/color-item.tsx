/** Client interaction for one copyable color token. */

'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ColorItemValue {
  light: string
  dark: string
}

export interface ColorItemProps {
  hex?: string
  color?: string
  name?: string
  value?: string | ColorItemValue
  light?: string
  dark?: string
  copy?: boolean
  className?: string
}

/** Render and copy a single color value without making the palette root client-only. */
export function ColorItemClient({ hex, color, name, value, light, dark, copy = true, className }: ColorItemProps) {
  const themedValue = light && dark ? { light, dark } : typeof value === 'object' ? value : null
  const resolvedColor = color ?? hex ?? (typeof value === 'string' ? value : themedValue?.light) ?? 'transparent'
  const copyValue = typeof value === 'object' ? `${value.light} / ${value.dark}` : value ?? hex ?? color ?? ''
  const [hasCopied, setHasCopied] = useState(false)

  async function copyColor() {
    if (!copyValue || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(copyValue)
      setHasCopied(true)
      window.setTimeout(() => setHasCopied(false), 1500)
    } catch {
      // The visible value remains selectable when clipboard permission fails.
    }
  }

  return (
    <div className={cn('not-prose group/color min-w-0 overflow-hidden rounded-lg border border-border bg-background', className)}>
      {themedValue ? (
        <div className="grid h-16 grid-cols-2 border-b border-border/50" aria-label={`${name ? `${name}, ` : ''}light ${themedValue.light}, dark ${themedValue.dark}`}>
          <span className="relative" style={{ backgroundColor: themedValue.light }}><span className="absolute bottom-1 left-1 rounded bg-white/75 px-1 text-[0.55rem] font-semibold uppercase text-black/70">light</span></span>
          <span className="relative" style={{ backgroundColor: themedValue.dark }}><span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[0.55rem] font-semibold uppercase text-white/80">dark</span></span>
        </div>
      ) : (
        <div className="h-16 w-full border-b border-border/50" style={{ backgroundColor: resolvedColor }} aria-label={`${name ? `${name}, ` : ''}${copyValue || resolvedColor}`} />
      )}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          {name ? <span className="block truncate text-sm font-medium text-foreground">{name}</span> : null}
          {copyValue ? <code className="block truncate text-xs text-foreground/55">{copyValue}</code> : null}
        </span>
        {copy && copyValue ? (
          <button type="button" onClick={copyColor} className="rounded p-1.5 text-foreground/45 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Copy ${name ?? copyValue} color`}>
            {hasCopied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
    </div>
  )
}
