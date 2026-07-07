'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// ResponseField
// ---------------------------------------------------------------------------

interface ResponseFieldProps {
  name: string
  type?: string
  required?: boolean
  children?: ReactNode
}

export function ResponseField({ name, type, required, children }: ResponseFieldProps) {
  return (
    <div className="my-4 border-b border-border/40 pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm font-semibold text-foreground">{name}</code>
        {type && (
          <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/70">
            {type}
          </span>
        )}
        {required && (
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            required
          </span>
        )}
      </div>
      {children && (
        <div className="mt-2 prose prose-sm dark:prose-invert text-foreground/80">{children}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ParamField
// ---------------------------------------------------------------------------

type ParamLocation = 'body' | 'query' | 'path' | 'header'

interface ParamFieldProps {
  body?: boolean
  query?: boolean
  path?: boolean
  header?: boolean
  name: string
  type?: string
  required?: boolean
  default?: string
  children?: ReactNode
}

const locationStyles: Record<ParamLocation, string> = {
  body: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20',
  query: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20',
  path: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20',
  header: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/20',
}

export function ParamField({ name, type, required, body, query, path, header, default: defaultValue, children }: ParamFieldProps) {
  const location: ParamLocation = path ? 'path' : query ? 'query' : header ? 'header' : 'body'
  return (
    <div className="my-4 border-b border-border/40 pb-4 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <code className="text-sm font-semibold text-foreground">{name}</code>
        <span className={cn('rounded border px-1.5 py-0.5 text-xs font-medium', locationStyles[location])}>
          {location}
        </span>
        {type && (
          <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/70">
            {type}
          </span>
        )}
        {required && (
          <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            required
          </span>
        )}
        {defaultValue !== undefined && (
          <span className="text-xs text-foreground/50">
            default: <code className="font-mono">{defaultValue}</code>
          </span>
        )}
      </div>
      {children && (
        <div className="mt-2 prose prose-sm dark:prose-invert text-foreground/80">{children}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expandable
// ---------------------------------------------------------------------------

interface ExpandableProps {
  title?: string
  defaultOpen?: boolean
  children?: ReactNode
}

export function Expandable({ title = 'Show child attributes', defaultOpen = false, children }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && (
        <div className="mt-3 border-l-2 border-border/40 pl-4">{children}</div>
      )}
    </div>
  )
}
