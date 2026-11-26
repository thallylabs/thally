/**
 * Decorate the existing Markdown tree with inline arrival boundaries. This is
 * presentation only: it never parses Markdown again, delays text, or wraps code.
 */

import type { Element, Root, RootContent, Text } from 'hast'

interface StreamWordOptions {
  hasCaret: boolean
}

function caret(): Element {
  return { type: 'element', tagName: 'stream-caret', properties: {}, children: [] }
}

/** Mark words outside code and put the cursor beside the last visible text. */
export function rehypeChatStreamWords({ hasCaret }: StreamWordOptions) {
  return (tree: Root) => {
    let tail: Text | undefined
    const findTail = (parent: Root | Element) => {
      for (const [index, child] of parent.children.entries()) {
        // Model images already render as alt text. Make that inert text part
        // of the same presentation tree so the cursor follows what is visible.
        if (child.type === 'element' && child.tagName === 'img') {
          const replacement: Text = { type: 'text', value: typeof child.properties.alt === 'string' ? child.properties.alt : '', position: child.position }
          parent.children[index] = replacement
          if (/\S/u.test(replacement.value)) tail = replacement
          continue
        }
        if (child.type === 'text' && /\S/u.test(child.value)) tail = child
        else if (child.type === 'element') findTail(child)
      }
    }
    findTail(tree)

    const decorate = (parent: Root | Element, inCode = false) => {
      const children: Array<RootContent> = []
      for (const child of parent.children) {
        if (child.type === 'element') {
          decorate(child, inCode || child.tagName === 'pre' || child.tagName === 'code')
          children.push(child)
          continue
        }
        if (child.type !== 'text') {
          children.push(child)
          continue
        }
        const hasTail = hasCaret && child === tail
        const tailEnd = child.value.trimEnd().length
        if (inCode) {
          // A cursor may sit in a code block, but code text/markup stays intact.
          if (hasTail) {
            children.push({ ...child, value: child.value.slice(0, tailEnd) }, caret(), { type: 'text', value: child.value.slice(tailEnd) })
          } else children.push(child)
          continue
        }
        for (const match of child.value.matchAll(/\S+|\s+/gu)) {
          const value = match[0]
          const end = match.index + value.length
          if (/^\s+$/u.test(value)) children.push({ type: 'text', value })
          else {
            children.push({
              type: 'element',
              tagName: 'stream-word',
              properties: { 'data-stream-end': (child.position?.start.offset ?? 0) + end },
              children: [{ type: 'text', value }],
            })
            if (hasTail && end === tailEnd) children.push(caret())
          }
        }
      }
      parent.children = children
    }
    decorate(tree)
    if (hasCaret && !tail) tree.children.push(caret())
  }
}
