import type { ReactNode } from 'react'
import { AlertTriangle, Info, Lightbulb, BookOpen, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

type NoteType = 'note' | 'tip' | 'info' | 'warning' | 'danger'

const toneStyles: Record<NoteType, string> = {
  note: 'border-accent text-foreground',
  tip: 'border-emerald-600 text-foreground dark:border-emerald-300',
  info: 'border-accent text-foreground',
  warning: 'border-amber-600 text-foreground dark:border-amber-300',
  danger: 'border-rose-600 text-foreground dark:border-rose-300',
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
    <div className={cn('not-prose my-6 max-w-[70ch] border-0 border-l-2 py-0.5 pl-4 text-sm', toneStyles[resolvedType], className)}>
      <div className="flex items-start gap-3 text-current">
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center text-current', toneAccent[resolvedType])}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="prose prose-sm text-current/90 dark:prose-invert">{children}</div>
      </div>
    </div>
  )
}
