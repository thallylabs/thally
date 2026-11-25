/**
 * Inline code in title strings (a component `title`, a page `description`).
 *
 * Mintlify renders the text between backticks as code. Renderers wrap the code
 * runs; anchors, outlines and meta tags read the plain text, so every consumer
 * agrees on what a title says.
 *
 * Kept here, dependency-free, because the MDX heading pass runs in the runtime
 * source generator, which cannot rely on `@thallylabs/core` being built. These
 * MUST stay identical to their namesakes in
 * `@thallylabs/core` (packages/core/src/slugify.ts): the content parser and
 * `thally check` use that copy, and a mismatch breaks in-page anchor links.
 */

/** One `code` span; the backticks are markup, the text between them is what renders. */
const INLINE_CODE = /`([^`\n]+)`/g

/** Split a title string into plain text and `inline code` runs, in order. */
export function inlineCodeParts(value: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = []
  let end = 0
  for (const match of value.matchAll(INLINE_CODE)) {
    if (match.index > end) parts.push({ text: value.slice(end, match.index), code: false })
    parts.push({ text: match[1], code: true })
    end = match.index + match[0].length
  }
  if (end < value.length) parts.push({ text: value.slice(end), code: false })
  return parts
}

/** A title string as plain text: each code span without its backticks. */
export function plainInlineText(value: string): string {
  return value.replace(INLINE_CODE, '$1')
}

/** One part of a title that may hold links: plain text, a `code` span, or a link around either. */
export type LinkedTitlePart = { text: string; code: boolean } | { href: string; parts: Array<{ text: string; code: boolean }> }

/**
 * A `code` span or a Markdown link (`[label](url)`) in a title string. A code
 * span is read first, so a link written inside backticks stays code. The `!` or
 * `\` an image or an escaped bracket starts with is matched too, so neither is
 * read as a link. No lookbehind: this also runs in browsers that lack it. A
 * label holds no `[` outside a code span, so a run of brackets is read once
 * and a long title cannot slow the page down.
 */
const LINKED_TITLE_TOKEN = /`([^`\n]+)`|[!\\]?\[((?:`[^`\n]+`|[^[\]`\n])+)\]\(([^()\s]+)\)/g

/** Schemes a title link may open; a URL with no scheme is a path, a fragment or a host. */
const TITLE_LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel'])

/** Whether a title link's URL is one a page may link to; anything else stays the text the author typed. */
function isTitleLinkUrl(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]
  return scheme === undefined || TITLE_LINK_SCHEMES.has(scheme.toLowerCase())
}

/**
 * Split a `<Step>` title into text, `code` spans and Markdown links
 * (`[label](url)`), in order. A title with no link splits exactly as
 * {@link inlineCodeParts} splits it, with neighbouring text kept as one part.
 * The renderer wraps the links; ids, outlines and search read
 * {@link plainLinkedTitle}, and the Markdown projection keeps the title as
 * written, which is already Markdown.
 */
export function linkedTitleParts(value: string): Array<LinkedTitlePart> {
  const parts: Array<LinkedTitlePart> = []
  const addText = (text: string): void => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && !('href' in last) && !last.code) last.text += text
    else parts.push({ text, code: false })
  }
  let end = 0
  for (const match of value.matchAll(LINKED_TITLE_TOKEN)) {
    addText(value.slice(end, match.index))
    const [whole, code, label, url] = match
    if (code !== undefined) parts.push({ text: code, code: true })
    else if (whole.startsWith('[') && label.trim() && isTitleLinkUrl(url)) parts.push({ href: url, parts: inlineCodeParts(label) })
    else {
      // Not a link (an image, an escaped bracket, a URL no page may open): the text stays as typed, its code spans still code.
      for (const part of inlineCodeParts(whole)) {
        if (part.code) parts.push(part)
        else addText(part.text)
      }
    }
    end = match.index + whole.length
  }
  addText(value.slice(end))
  return parts
}

/** A `<Step>` title as plain text: each link as its label, each code span without its backticks. */
export function plainLinkedTitle(value: string): string {
  return linkedTitleParts(value)
    .map((part) => ('href' in part ? part.parts.map((inner) => inner.text).join('') : part.text))
    .join('')
}

/** The links a `<Step>` title holds, in order, each with the plain text of its label. */
export function linkedTitleLinks(value: string): Array<{ url: string; text: string }> {
  return linkedTitleParts(value).flatMap((part) =>
    'href' in part ? [{ url: part.href, text: part.parts.map((inner) => inner.text).join('') }] : [])
}
