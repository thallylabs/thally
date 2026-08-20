/**
 * Semantic MDX callouts shared by every standalone and managed Thally site.
 *
 * The shell deliberately owns its complete surface treatment so authors only
 * choose intent; site accent tokens still flow into the branded Note variant.
 */

import type { ReactNode } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  Info,
  Lightbulb,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type NoteType = 'note' | 'tip' | 'info' | 'warning' | 'check' | 'danger'

const toneStyles: Record<NoteType, string> = {
  note: 'border-accent/45 bg-accent/[0.14] text-foreground dark:border-accent/40 dark:bg-accent/[0.17]',
  tip: 'border-teal-600/45 bg-teal-500/[0.14] text-teal-950 dark:border-teal-300/35 dark:bg-teal-300/[0.16] dark:text-teal-50',
  info: 'border-sky-600/45 bg-sky-500/[0.14] text-sky-950 dark:border-sky-300/35 dark:bg-sky-300/[0.16] dark:text-sky-50',
  warning: 'border-amber-600/50 bg-amber-500/[0.16] text-amber-950 dark:border-amber-300/40 dark:bg-amber-300/[0.18] dark:text-amber-50',
  check: 'border-emerald-600/45 bg-emerald-500/[0.14] text-emerald-950 dark:border-emerald-300/35 dark:bg-emerald-300/[0.16] dark:text-emerald-50',
  danger: 'border-rose-600/45 bg-rose-500/[0.14] text-rose-950 dark:border-rose-300/35 dark:bg-rose-300/[0.16] dark:text-rose-50',
}

const toneAccent: Record<NoteType, string> = {
  note: 'text-accent',
  tip: 'text-teal-700 dark:text-teal-200',
  info: 'text-sky-600 dark:text-sky-300',
  warning: 'text-amber-700 dark:text-amber-200',
  check: 'text-emerald-700 dark:text-emerald-200',
  danger: 'text-rose-700 dark:text-rose-200',
}

const toneIcon: Record<NoteType, typeof Info> = {
  note: BookOpen,
  tip: Lightbulb,
  info: Info,
  warning: AlertTriangle,
  check: Check,
  danger: ShieldAlert,
}

interface NoteProps {
  type?: NoteType
  className?: string
  children: ReactNode
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join(' ')
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    if (props?.children) {
      return extractText(props.children)
    }
  }
  return ''
}

function resolveTypeFromContent(children: ReactNode): NoteType {
  const normalized = extractText(children).toLowerCase()
  if (!normalized) {
    return 'info'
  }
  const dangerKeywords = ['never expose', 'never share', 'keep your key', 'abuse', 'loss of funds', 'secure']
  if (dangerKeywords.some((keyword) => normalized.includes(keyword))) {
    return 'danger'
  }
  const warningKeywords = ['warning', 'caution', 'be careful', '注意', '小心']
  if (warningKeywords.some((keyword) => normalized.includes(keyword))) {
    return 'warning'
  }
  return 'info'
}

export function Note({ type, className, children }: NoteProps) {
  const resolvedType = type ?? resolveTypeFromContent(children)
  const Icon = toneIcon[resolvedType]
  return (
    <aside
      data-callout={resolvedType}
      className={cn(
        'not-prose my-6 max-w-[70ch] rounded-xl border px-4 py-3 text-sm leading-6',
        toneStyles[resolvedType],
        className,
      )}
    >
      <div className="flex items-start gap-3 text-current">
        <span
          className={cn(
            'flex h-6 w-5 shrink-0 items-center justify-center text-current',
            toneAccent[resolvedType],
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="thally-callout-content prose prose-sm max-w-none text-current/90 prose-p:my-0 prose-li:my-1 prose-ol:my-2 prose-ul:my-2 dark:prose-invert">
          {children}
        </div>
      </div>
    </aside>
  )
}
