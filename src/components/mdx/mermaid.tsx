/** Render authored Mermaid diagrams without allowing diagram text to inject active HTML. */

'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'

interface MermaidProps {
  /** Preferred explicit diagram definition for component-style usage. */
  chart?: string
  /** Backward-compatible template-literal child definition. */
  children?: ReactNode
}

const MAX_DEFINITION_CHARACTERS = 64 * 1024
let renderQueue: Promise<void> = Promise.resolve()

type MermaidTheme = 'dark' | 'neutral'

interface RenderedDiagram {
  definition: string
  theme?: MermaidTheme
  svg: string
  error: string
}

/**
 * Mermaid owns mutable global configuration and a temporary render container.
 * Serialize the initialize/render pair so sibling diagrams cannot overwrite
 * one another while React mounts them concurrently.
 */
function renderDiagram(id: string, definition: string, theme: MermaidTheme): Promise<string> {
  const pending = renderQueue.then(async () => {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })
    const result = await mermaid.render(`mermaid-${id}`, definition)
    if (!result.svg.trim()) throw new Error('Mermaid returned an empty diagram.')
    return result.svg
  })
  renderQueue = pending.then(() => undefined, () => undefined)
  return pending
}

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
  const { resolvedTheme } = useTheme()
  const [rendered, setRendered] = useState<RenderedDiagram>({
    definition: '',
    svg: '',
    error: '',
  })
  const definition = resolveDefinition(chart, children)
  const diagramTheme: MermaidTheme | undefined = resolvedTheme === 'dark'
    ? 'dark'
    : resolvedTheme === 'light'
      ? 'neutral'
      : undefined
  const definitionError = !definition
    ? 'a diagram definition is required.'
    : definition.length > MAX_DEFINITION_CHARACTERS
      ? 'the diagram definition is too large to render safely.'
      : ''
  const isCurrentRender = rendered.definition === definition && rendered.theme === diagramTheme
  const svg = isCurrentRender ? rendered.svg : ''
  const error = isCurrentRender ? rendered.error : ''

  useEffect(() => {
    let cancelled = false
    if (definitionError || !diagramTheme) return () => { cancelled = true }

    // Migrated diagrams are untrusted input. `renderDiagram` always uses
    // strict Mermaid security before the generated SVG enters the DOM below.
    void renderDiagram(id, definition, diagramTheme)
      .then((renderedSvg) => {
        if (!cancelled) {
          setRendered({ definition, theme: diagramTheme, svg: renderedSvg, error: '' })
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setRendered({ definition, theme: diagramTheme, svg: '', error: String(renderError) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [definition, definitionError, diagramTheme, id])

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
