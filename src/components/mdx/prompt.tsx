'use client'

/** Copyable AI prompt card and explicit legacy terminal components. */

import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Icon } from '@/components/mdx/content-icon'

type PromptAction = 'copy' | 'cursor'

interface PromptProps {
  description?: ReactNode
  children?: ReactNode
  actions?: Array<PromptAction>
  icon?: string
  iconType?: 'solid' | 'outline'
}

async function copyText(text: string) {
  if (!navigator.clipboard) throw new Error('Clipboard is unavailable')
  await navigator.clipboard.writeText(text)
}

function promptText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(promptText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return promptText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

/** Display a reusable prompt with copy and optional Cursor actions. */
export function Prompt({ description, children, actions = ['copy'], icon, iconType }: PromptProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  // Existing Thally sites used <Prompt> as a terminal wrapper. A missing
  // description is an unambiguous legacy signal, so those pages keep working.
  if (!description) return <Terminal>{children}</Terminal>

  const uniqueActions = [...new Set(actions)].filter((action): action is PromptAction => action === 'copy' || action === 'cursor')
  const copyValue = promptText(children).trim()
  const cursorHref = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(copyValue)}`

  return (
    <section className="not-prose my-6 rounded-xl border border-border bg-muted/25 p-4" data-mdx-prompt>
      <div className="flex items-start gap-3">
        <Icon icon={icon ?? 'sparkles'} iconType={iconType} className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1 text-sm text-foreground/80">{description}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {uniqueActions.includes('copy') ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => void copyText(copyValue).then(() => {
              setCopyStatus('copied')
              window.setTimeout(() => setCopyStatus('idle'), 1200)
            }).catch(() => {
              setCopyStatus('error')
              window.setTimeout(() => setCopyStatus('idle'), 1800)
            })}
          >
            {copyStatus === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy unavailable' : 'Copy prompt'}
          </button>
        ) : null}
        {uniqueActions.includes('cursor') ? (
          <a href={cursorHref} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Open in Cursor</a>
        ) : null}
      </div>
    </section>
  )
}

export function Terminal({ children }: { children: ReactNode }) {
  return <div className="not-prose my-6 overflow-hidden rounded-2xl border border-border/40 bg-muted/20 font-mono text-sm">{children}</div>
}

export function TerminalInput({ children }: { children: ReactNode }) {
  return <div className="flex gap-3 border-b border-border/30 bg-background px-4 py-3"><span className="shrink-0 select-none font-semibold text-accent">$</span><span className="text-foreground/90">{children}</span></div>
}

export function TerminalOutput({ children }: { children: ReactNode }) {
  return <div className="px-4 py-3 text-foreground/70">{children}</div>
}

export const PromptUser = TerminalInput
export const PromptAssistant = TerminalOutput
