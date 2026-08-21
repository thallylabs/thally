/** Render authored Mermaid diagrams without allowing diagram text to inject active HTML. */

'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'

interface MermaidProps {
  /** Preferred explicit diagram definition for component-style usage. */
  chart?: string
  /** Backward-compatible template-literal child definition. */
  children?: ReactNode
}

const MAX_DEFINITION_CHARACTERS = 64 * 1024

function resolveDefinition(chart: string | undefined, children: ReactNode): string {
  if (typeof chart === 'string') return chart.trim()
  if (typeof children === 'string') return children.trim()
  if (Array.isArray(children) && children.every((child) => typeof child === 'string')) {
    return children.join('').trim()
  }
  return ''
}

export function Mermaid({ chart, children }: MermaidProps) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')
  const definition = resolveDefinition(chart, children)
  const definitionError = !definition
    ? 'a diagram definition is required.'
    : definition.length > MAX_DEFINITION_CHARACTERS
      ? 'the diagram definition is too large to render safely.'
      : ''

  useEffect(() => {
    let cancelled = false
    setSvg('')
    setError('')
    if (definitionError) return () => { cancelled = true }

    void import('mermaid')
      .then((module) => {
        if (cancelled) return
        const mermaid = module.default
        // Migrated diagrams are untrusted input. Strict mode sanitizes labels
        // and link targets before the generated SVG enters the DOM below.
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
        return mermaid.render(`mermaid-${id}`, definition)
      })
      .then((result) => {
        if (!cancelled && result) setSvg(result.svg)
      })
      .catch((renderError: unknown) => {
        if (!cancelled) setError(String(renderError))
      })
    return () => {
      cancelled = true
    }
  }, [definition, definitionError, id])

  if (definitionError) {
    return (
      <div role="alert" className="not-prose my-6 rounded-2xl border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        Mermaid render error: {definitionError}
      </div>
    )
  }

  if (error) {
    return (
      <div className="not-prose my-6 rounded-2xl border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        Mermaid render error: {error}
      </div>
    )
  }

  if (!svg) {
    return (
      <div data-component-name="mermaid-container" className="not-prose my-6 h-32 animate-pulse rounded-2xl border border-border/40 bg-muted/40" />
    )
  }

  return (
    <div
      data-component-name="mermaid-container"
      className="not-prose my-6 overflow-x-auto rounded-2xl border border-border/40 bg-background p-6 [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
