'use client'

import { useEffect, useId, useState } from 'react'

interface MermaidProps {
  /** The Mermaid diagram definition string */
  children: string
}

export function Mermaid({ children }: MermaidProps) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    import('mermaid').then((m) => {
      if (cancelled) return
      const mermaid = m.default
      mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' })
      mermaid
        .render(`mermaid-${id}`, children.trim())
        .then(({ svg: rendered }) => {
          if (!cancelled) setSvg(rendered)
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(String(err))
        })
    })
    return () => {
      cancelled = true
    }
  }, [children, id])

  if (error) {
    return (
      <div className="not-prose my-6 rounded-2xl border border-rose-300/40 bg-rose-50/50 px-4 py-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        Mermaid render error: {error}
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="not-prose my-6 h-32 animate-pulse rounded-2xl border border-border/40 bg-muted/40" />
    )
  }

  return (
    <div
      className="not-prose my-6 overflow-x-auto rounded-2xl border border-border/40 bg-background p-6 [&_svg]:mx-auto"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
