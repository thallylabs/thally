/**
 * Mintlify-parity `<Latex>` component: renders LaTeX with KaTeX server-side.
 * `<Latex>E=mc^2</Latex>` renders inline; `<Latex block>...</Latex>` (or
 * content containing a newline) renders in display mode.
 */

import katex from 'katex'
import { isValidElement, type ReactNode } from 'react'

import 'katex/dist/katex.min.css'

interface LatexProps {
  children?: ReactNode
  block?: boolean
}

function flattenText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(flattenText).join('')
  // Markdown inside the tag (`_x_` parsed as emphasis) arrives as elements;
  // keep their text rather than dropping it.
  if (isValidElement<{ children?: ReactNode }>(children)) return flattenText(children.props.children)
  return ''
}

export function Latex({ children, block }: LatexProps) {
  const source = flattenText(children).trim()
  const displayMode = block ?? source.includes('\n')
  let html: string | undefined
  try {
    html = katex.renderToString(source, { throwOnError: true, displayMode, trust: false })
  } catch {
    html = undefined
  }
  if (html === undefined) return <code className="font-mono text-sm">{source}</code>
  const Tag = displayMode ? 'div' : 'span'
  return <Tag dangerouslySetInnerHTML={{ __html: html }} />
}
