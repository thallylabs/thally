import type { Element, ElementContent } from 'hast'

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function serialize(node: ElementContent): string {
  if (node.type === 'text') return escape(node.value)
  if (node.type !== 'element') return ''
  const { className, style } = node.properties as { className?: Array<string>; style?: string }
  const attrs = (className?.length ? ` class="${className.join(' ')}"` : '') + (style ? ` style="${style}"` : '')
  return `<${node.tagName}${attrs}>${node.children.map(serialize).join('')}</${node.tagName}>`
}

/** Inner HTML of a transformed fence's `<code>`: what the old string pipeline emitted. */
export const codeInnerHtml = (pre: Element): string => (pre.children[0] as Element).children.map(serialize).join('')
