/**
 * Structured API-field rows used by authored MDX and generated OpenAPI pages.
 *
 * Field metadata remains visible at a glance while nested attributes use an
 * accessible disclosure control. The same primitives intentionally serve the
 * generated API renderer and customer-authored component surface.
 */

'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useApiLabels } from '@/components/api/api-locale'
import { useParameterLink } from '@/components/api/parameter-link'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/**
 * Typography for a field's description. Tailwind's `not-prose` opt-out reaches every descendant,
 * so no ancestor of this block may carry it, or paragraphs, inline code and fenced code lose
 * their prose styles. The trailing rules drop the first and last block's outer margin inside
 * rendered Markdown, so a one-paragraph description keeps the row height it has without prose.
 */
const descriptionClass =
  'prose prose-sm mt-2.5 max-w-none text-foreground/75 dark:prose-invert [&_div>:first-child]:mt-0 [&_div>:last-child]:mb-0'

// ---------------------------------------------------------------------------
// ResponseField
// ---------------------------------------------------------------------------

interface ResponseFieldProps {
  /** Set by the page's heading pass, so a link to the field lands on it. */
  id?: string
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
  id,
  name,
  type,
  required,
  deprecated,
  default: defaultValue,
  pre = [],
  post = [],
  children,
}: ResponseFieldProps) {
  const t = useApiLabels()
  const { active, ...linkEvents } = useParameterLink(name)
  return (
    <section {...linkEvents} tabIndex={0} data-p={name} data-highlighted={active || undefined} className="thally-parameter">
      <div id={id} className="thally-parameter-header not-prose">
        {pre.map((label) => <span key={`pre-${label}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.68rem] font-medium text-foreground/60">{label}</span>)}
        <code className={cn('text-sm font-semibold text-foreground', deprecated && 'line-through opacity-65')}>{name}</code>
        {post.map((label) => <span key={`post-${label}`} className="rounded bg-muted px-1.5 py-0.5 text-[0.68rem] font-medium text-foreground/60">{label}</span>)}
        {type && (
          <span className="thally-parameter-type">
            {type}
          </span>
        )}
        {required && (
          <span className="thally-parameter-required">
            {t('required')}
          </span>
        )}
        {deprecated && <span className="text-[0.7rem] font-semibold text-amber-700 dark:text-amber-300">{t('deprecated')}</span>}
        {defaultValue !== undefined && (
          <span className="text-xs text-foreground/50">
            {t('default')} <code className="font-mono text-foreground/70">{defaultValue}</code>
          </span>
        )}
      </div>
      {children && (
        <div className={descriptionClass}>{children}</div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// ParamField
// ---------------------------------------------------------------------------

interface ParamFieldProps {
  /** Set by the page's heading pass, so a link to the field lands on it. */
  id?: string
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

export function ParamField({ id, name, type, required, deprecated, body, query, path, header, default: defaultValue, placeholder, children }: ParamFieldProps) {
  const t = useApiLabels()
  // As on Mintlify, only a header names its location; body, query and path fields show name, type and required.
  const isHeader = !path && !query && Boolean(header)
  const locatedName = [path, query, header, body].find((value): value is string => typeof value === 'string' && value.length > 0)
  const fieldName = locatedName ?? name ?? 'parameter'
  const { active, ...linkEvents } = useParameterLink(fieldName)
  return (
    <section {...linkEvents} tabIndex={0} data-p={fieldName} data-highlighted={active || undefined} className="thally-parameter">
      <div id={id} className="thally-parameter-header not-prose">
        <code className={cn('text-sm font-semibold text-foreground', deprecated && 'line-through opacity-65')}>{fieldName}</code>
        {isHeader && (
          <span className="thally-parameter-location font-mono text-[0.7rem] font-medium text-green-700 dark:text-green-300">header</span>
        )}
        {type && (
          <span className="thally-parameter-type">
            {type}
          </span>
        )}
        {required && (
          <span className="thally-parameter-required">
            {t('required')}
          </span>
        )}
        {deprecated && <span className="text-[0.7rem] font-semibold text-amber-700 dark:text-amber-300">{t('deprecated')}</span>}
        {defaultValue !== undefined && (
          <span className="text-xs text-foreground/50">
            {t('default')}: <code className="font-mono">{defaultValue}</code>
          </span>
        )}
        {placeholder ? <span className="text-xs text-foreground/50">placeholder <code className="font-mono text-foreground/70">{placeholder}</code></span> : null}
      </div>
      {children && (
        <div className={descriptionClass}>{children}</div>
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
  /** Mounts the children on first open, so a large generated schema is not in the page until asked for. */
  lazy?: boolean
  /** With `lazy`: the id prefix of the fields inside; a link to one of them opens this, as it cannot be found in the DOM. */
  anchor?: string
  children?: ReactNode
}

export function Expandable({ title, defaultOpen = false, lazy = false, anchor, children }: ExpandableProps) {
  const t = useApiLabels()
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)
  if (open && !mounted) setMounted(true)
  const contentId = useId()
  const content = useRef<HTMLDivElement>(null)
  const target = useRef<string | null>(null)
  // A link to a field inside a collapsed Expandable opens it, as the <details> Mintlify renders does.
  useEffect(() => {
    const reveal = () => {
      let id: string
      try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
      if (!id || !content.current?.hidden) return
      const element = document.getElementById(id)
      // A lazy field is not in the DOM until opened: its id says whose it is. Rows below it are mounted as their own Expandables open.
      const inside = element ? content.current.contains(element) : lazy && anchor !== undefined && id.startsWith(`${anchor}-`)
      if (!inside) return
      target.current = id
      setOpen(true)
    }
    reveal()
    // A hash may first select a lazy API union branch. Its field does not exist until that branch mounts, after this effect.
    const observer = new MutationObserver(reveal)
    if (content.current) observer.observe(content.current, { childList: true, subtree: true })
    window.addEventListener('hashchange', reveal)
    return () => {
      observer.disconnect()
      window.removeEventListener('hashchange', reveal)
    }
  }, [lazy, anchor])
  // The browser could not scroll to a hidden field when the page loaded; once it has a box, go there.
  useEffect(() => {
    const element = open && target.current ? document.getElementById(target.current) : null
    if (!element || element.closest('[hidden]')) return
    element.scrollIntoView()
    target.current = null
  }, [open])
  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex items-center gap-1.5 rounded-md py-1 text-xs font-medium text-accent transition-colors hover:text-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-90')} aria-hidden="true" />
        {title ?? t('showChildAttributes')}
      </button>
      <div
        ref={content}
        id={contentId}
        hidden={!open}
        className="mt-3 border-l border-border pl-4"
      >
        {lazy && !mounted ? null : children}
      </div>
    </div>
  )
}
