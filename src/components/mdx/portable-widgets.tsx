/**
 * Portable document widgets used when an imported site wraps ordinary MDX
 * content in a platform-specific presentation component. The rendering is
 * owned by Thally, so migrated pages do not depend on the source platform's
 * runtime or CSS classes.
 */

import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react'

interface ApiTableProps {
  children?: ReactNode
  name?: string
}

interface WidgetElementProps {
  children?: ReactNode
  id?: string
}

function firstCellText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return firstCellText(node[0])
  if (isValidElement<WidgetElementProps>(node)) return firstCellText(Children.toArray(node.props.children)[0])
  return ''
}

function addRowAnchors(node: ReactNode, name?: string, isBody = false): ReactNode {
  if (Array.isArray(node)) return node.map((child) => addRowAnchors(child, name, isBody))
  if (!isValidElement<WidgetElementProps>(node)) return node
  const children = node.props.children
  const nextChildren = children === undefined ? undefined : Children.map(children, (child) => addRowAnchors(child, name, isBody || node.type === 'tbody'))
  if (node.type !== 'tr' || !isBody) return nextChildren === undefined ? node : cloneElement(node, { children: nextChildren })
  const rowName = firstCellText(Children.toArray(children)[0]).trim()
  return cloneElement(node, {
    ...(rowName && !node.props.id ? { id: name ? `${name}-${rowName}` : rowName } : {}),
    ...(nextChildren === undefined ? {} : { children: nextChildren }),
  })
}

/** Keep API reference tables and their deep-link anchors without the source theme. */
export function ApiTable({ children, name }: ApiTableProps) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-border [&_table]:m-0 [&_table]:w-full [&_table]:border-collapse [&_th]:bg-muted/60 [&_th]:text-left [&_th]:font-semibold [&_td]:align-top [&_td]:border-t [&_td]:border-border [&_th]:p-3 [&_td]:p-3">
      {addRowAnchors(children, name)}
    </div>
  )
}

interface BrowserPreviewProps {
  children?: ReactNode
  url?: string
  minHeight?: number
  style?: CSSProperties
  bodyStyle?: CSSProperties
}

/** Render a browser mockup around authored content with Thally styling. */
export function BrowserPreview({ children, url = 'http://localhost:3000', minHeight, style, bodyStyle }: BrowserPreviewProps) {
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-border bg-background shadow-sm" style={{ ...style, minHeight }}>
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-4 py-3">
        <span aria-hidden="true" className="flex shrink-0 gap-1.5">
          <span className="size-2.5 rounded-full bg-red-400" />
          <span className="size-2.5 rounded-full bg-amber-400" />
          <span className="size-2.5 rounded-full bg-green-400" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-1 text-center text-xs text-muted-foreground">{url}</span>
      </div>
      <div className="p-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0" style={bodyStyle}>{children}</div>
    </div>
  )
}

/** Preview a safe URL in the same browser chrome without importing a source theme. */
export function IframePreview({ url }: { url?: string }) {
  if (typeof url !== 'string' || !url) return null
  let isSafe = false
  try {
    const parsed = new URL(url, 'https://thally.invalid')
    isSafe = (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !url.startsWith('//') && !url.includes('\\')
  } catch {
    return null
  }
  if (!isSafe) return null
  return (
    <BrowserPreview url={url} bodyStyle={{ padding: 0 }}>
      <iframe
        src={url}
        title={url}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-popups"
        className="block h-[300px] w-full border-0"
      />
    </BrowserPreview>
  )
}
