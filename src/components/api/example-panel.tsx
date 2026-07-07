interface ExamplePanelProps {
  title: string
  mediaType: string
  example?: unknown
  examples?: Array<{
    key: string
    summary?: string
    description?: string
    value: unknown
  }>
}

export function ExamplePanel({ title, mediaType, example, examples = [] }: ExamplePanelProps) {
  const resolvedExamples = example ? [{ key: 'example', value: example }, ...examples] : examples
  if (!resolvedExamples.length) {
    return null
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/40 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">
        <span>{title}</span>
        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-widest">{mediaType}</span>
      </div>
      <div className="space-y-6">
        {resolvedExamples.map((entry) => (
          <div key={entry.key} className="space-y-2">
            {(resolvedExamples.length > 1 || entry.summary) ? (
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">{entry.summary ?? entry.key}</p>
            ) : null}
            {entry.description ? <p className="text-sm text-foreground/70">{entry.description}</p> : null}
            <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/80 p-4 text-xs leading-relaxed text-foreground/80">
              {formatValue(entry.value)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatValue(value: unknown) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

