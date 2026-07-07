import type { ReactNode } from 'react'
import { AlertTriangle, Info, Lightbulb, BookOpen, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

type NoteType = 'note' | 'tip' | 'info' | 'warning' | 'danger'

const toneStyles: Record<NoteType, string> = {
  note: 'border-accent/40 bg-accent/10 text-foreground dark:border-accent/30 dark:bg-accent/15 dark:text-foreground',
  tip: 'border-emerald-500/40 bg-emerald-50/80 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100',
  info: 'border-sky-500/40 bg-sky-50/80 text-sky-900 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-100',
  warning: 'border-amber-500/40 bg-amber-50/80 text-amber-900 dark:border-amber-300/30 dark:bg-amber-500/10 dark:text-amber-100',
  danger: 'border-rose-500/40 bg-rose-50/80 text-rose-900 dark:border-rose-300/30 dark:bg-rose-500/10 dark:text-rose-100',
}

const toneAccent: Record<NoteType, string> = {
  note: 'text-accent',
  tip: 'text-emerald-600 dark:text-emerald-300',
  info: 'text-sky-600 dark:text-sky-300',
  warning: 'text-amber-600 dark:text-amber-200',
  danger: 'text-rose-600 dark:text-rose-200',
}

const toneIcon: Record<NoteType, typeof Info> = {
  note: BookOpen,
  tip: Lightbulb,
  info: Info,
  warning: AlertTriangle,
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
    <div className={cn('not-prose my-6 rounded-2xl border px-4 py-3 text-sm shadow-sm', toneStyles[resolvedType], className)}>
      <div className="flex items-start gap-3 text-current">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center text-current', toneAccent[resolvedType])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="prose prose-sm text-current/90 dark:prose-invert">{children}</div>
      </div>
    </div>
  )
}

