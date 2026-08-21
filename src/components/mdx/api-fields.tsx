/**
 * Structured API-field rows used by authored MDX and generated OpenAPI pages.
 *
 * Field metadata remains visible at a glance while nested attributes use an
 * accessible disclosure control. The same primitives intentionally serve the
 * generated API renderer and customer-authored component surface.
 */

'use client'

import { useId, useState } from 'react'
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
  deprecated?: boolean
  default?: ReactNode
  pre?: Array<string>
  post?: Array<string>
  children?: ReactNode
}

export function ResponseField({
  name,
  type,
  required,
  deprecated,
  default: defaultValue,
  pre = [],
  post = [],
  children,
}: ResponseFieldProps) {
  return (
    <section className="not-prose border-b border-border/70 py-5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        {pre.map((label) => <span key={`pre-${label}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.68rem] font-medium text-foreground/60">{label}</span>)}
        <code className={cn('text-sm font-semibold text-foreground', deprecated && 'line-through opacity-65')}>{name}</code>
        {post.map((label) => <span key={`post-${label}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.68rem] font-medium text-foreground/60">{label}</span>)}
        {type && (
          <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/70">
            {type}
          </span>
        )}
        {required && (
          <span className="text-[0.7rem] font-semibold text-rose-600 dark:text-rose-400">
            required
          </span>
        )}
        {deprecated && <span className="text-[0.7rem] font-semibold text-amber-700 dark:text-amber-300">deprecated</span>}
        {defaultValue !== undefined && (
          <span className="text-xs text-foreground/50">
            default <code className="font-mono text-foreground/70">{defaultValue}</code>
          </span>
        )}
      </div>
      {children && (
        <div className="prose prose-sm mt-2.5 max-w-none text-foreground/75 dark:prose-invert">{children}</div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ParamField
// ---------------------------------------------------------------------------

type ParamLocation = 'body' | 'query' | 'path' | 'header'

interface ParamFieldProps {
  body?: boolean | string
  query?: boolean | string
  path?: boolean | string
  header?: boolean | string
  name?: string
  type?: string
  required?: boolean
  deprecated?: boolean
  default?: ReactNode
  placeholder?: string
  children?: ReactNode
}

const locationStyles: Record<ParamLocation, string> = {
  body: 'text-violet-700 dark:text-violet-300',
  query: 'text-sky-700 dark:text-sky-300',
  path: 'text-amber-700 dark:text-amber-300',
  header: 'text-green-700 dark:text-green-300',
}

export function ParamField({ name, type, required, deprecated, body, query, path, header, default: defaultValue, placeholder, children }: ParamFieldProps) {
  const location: ParamLocation = path ? 'path' : query ? 'query' : header ? 'header' : 'body'
  const locatedName = [path, query, header, body].find((value): value is string => typeof value === 'string' && value.length > 0)
  const fieldName = locatedName ?? name ?? 'parameter'
  return (
    <section className="not-prose border-b border-border/70 py-5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
        <code className={cn('text-sm font-semibold text-foreground', deprecated && 'line-through opacity-65')}>{fieldName}</code>
        <span className={cn('font-mono text-[0.7rem] font-medium', locationStyles[location])}>
          {location}
        </span>
        {type && (
          <span className="rounded border border-border/50 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/70">
            {type}
          </span>
        )}
        {required && (
          <span className="text-[0.7rem] font-semibold text-rose-600 dark:text-rose-400">
            required
          </span>
        )}
        {deprecated && <span className="text-[0.7rem] font-semibold text-amber-700 dark:text-amber-300">deprecated</span>}
        {defaultValue !== undefined && (
          <span className="text-xs text-foreground/50">
            default: <code className="font-mono">{defaultValue}</code>
          </span>
        )}
        {placeholder ? <span className="text-xs text-foreground/50">placeholder <code className="font-mono text-foreground/70">{placeholder}</code></span> : null}
      </div>
      {children && (
        <div className="prose prose-sm mt-2.5 max-w-none text-foreground/75 dark:prose-invert">{children}</div>
      )}
    </section>
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
  const contentId = useId()
  return (
    <div className="not-prose my-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-accent transition-colors hover:text-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
        {title}
      </button>
      <div
        id={contentId}
        hidden={!open}
        className="mt-3 border-l border-border pl-4"
      >
        {children}
      </div>
    </div>
  )
}
