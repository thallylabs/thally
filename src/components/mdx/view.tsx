interface ViewProps {
  src: string
  height?: number | string
  title?: string
}

export function View({ src, height = 500, title = 'Live preview' }: ViewProps) {
  const h = typeof height === 'number' ? `${height}px` : height
  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border border-border/40 bg-muted/20">
      <iframe
        src={src}
        title={title}
        style={{ height: h }}
        className="w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        loading="lazy"
      />
    </div>
  )
}
