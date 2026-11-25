/**
 * Slug helper for heading anchors and page ids.
 *
 * Kept dependency-free (no clsx/tailwind-merge) so the framework-agnostic core
 * carries no UI-layer imports. The root app re-exports this from
 * `src/lib/utils` so the whole codebase shares one slugify implementation —
 * heading ids emitted by the content parser must match the ids the MDX renderer
 * assigns to `<h2>`…`<h6>`, or in-page anchor links break.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Ids for a page's headings, in document order: `foo`, `foo-2`, `foo-3`. Each
 * target's `base` is the id its author fixed (`explicit`) or the slug of its
 * text. An explicit id keeps its spelling and is reserved for the whole page, so
 * a generated id never takes it, wherever it sits. A target with no base (text
 * that slugifies to nothing) gets none. `used` holds every id given, which a
 * page's fields are numbered against.
 */
export function numberHeadingIds(targets: ReadonlyArray<{ base: string; explicit: boolean }>): { ids: Array<string | undefined>; used: Set<string> } {
  const reserved = new Set(targets.flatMap(({ base, explicit }) => (explicit && base ? [base] : [])))
  const used = new Set<string>()
  const occurrences = new Map<string, number>()
  const ids = targets.map(({ base, explicit }) => {
    if (!base) return undefined
    let id = base
    let occurrence = 1
    if (explicit) {
      while (used.has(id)) id = `${base}-${++occurrence}`
    } else {
      occurrence = occurrences.get(base) ?? 0
      do id = ++occurrence === 1 ? base : `${base}-${occurrence}`
      while (used.has(id) || reserved.has(id))
      occurrences.set(base, occurrence)
    }
    used.add(id)
    return id
  })
  return { ids, used }
}

/**
 * Anchor base of a `<ParamField>` or `<ResponseField>`, as Mintlify serves it:
 * `param-` and the field's name in kebab case, for both components. A camel-case
 * boundary starts a new word (`expiresInDays`, `GitHub`), any run of characters
 * that are not letters or digits separates words (`ratelimits[].name`,
 * `--root-key`, `utm_campaign`), and digits stay with the letters before them
 * (`latency_p75`). Undefined when the name leaves nothing to spell.
 */
export function fieldAnchorBase(name: string): string | undefined {
  const words = name
    .normalize('NFC')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '')
  return words ? `param-${words}` : undefined
}

/** The part of an MDX `{…}` node that `constantString` reads: MDX keeps the expression's syntax tree in `data.estree`. */
interface ExpressionNode {
  data?: {
    estree?: {
      body?: Array<{
        type?: string
        expression?: { type?: string; value?: unknown; expressions?: Array<unknown>; quasis?: Array<{ value?: { cooked?: string | null } }> }
      }>
    }
  }
}

/**
 * The string a `{…}` node always evaluates to, when its whole content is a string
 * literal or a template literal with no `${}`: `title={"Param name"}` hands a
 * component the same string as `title="Param name"`, and `{"Param name"}` in a
 * heading renders the same text as `Param name`. Null for any other expression,
 * a comment, a number, or a node that carries no syntax tree.
 */
export function constantString(node: unknown): string | null {
  const body = (node as ExpressionNode | null | undefined)?.data?.estree?.body
  if (body?.length !== 1 || body[0].type !== 'ExpressionStatement') return null
  const expression = body[0].expression
  if (expression?.type === 'Literal' && typeof expression.value === 'string') return expression.value
  if (expression?.type === 'TemplateLiteral' && expression.expressions?.length === 0) return expression.quasis?.[0]?.value?.cooked ?? null
  return null
}

/** Attributes that name a field, in the order the component shows them. */
const FIELD_NAME_ATTRIBUTES = new Map([
  ['ParamField', ['path', 'query', 'header', 'body', 'name']],
  ['ResponseField', ['name']],
])

/**
 * The name a field element shows, which its anchor is made from. `attribute`
 * reads one literal attribute: a string, or `null` for a value that is not one
 * (an expression). Undefined for any other tag and for a field with no name.
 */
export function fieldAnchorName(tag: string, attribute: (name: string) => string | null | undefined): string | undefined {
  for (const name of FIELD_NAME_ATTRIBUTES.get(tag) ?? []) {
    const value = attribute(name)
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * The anchor of one field on a page, given the ids the page already uses. A
 * repeat is numbered from `-1` in document order (`param-app-id`,
 * `param-app-id-1`, `param-app-id-2`), and the numbering is shared by both
 * components. The id is recorded in `used`.
 */
export function uniqueFieldId(base: string, used: Set<string>): string {
  let id = base
  for (let occurrence = 1; used.has(id); occurrence++) id = `${base}-${occurrence}`
  used.add(id)
  return id
}

/**
 * The anchors of a page's fields, in document order. `bases` are the fields'
 * anchor bases and `used` the ids the page's headings already took. `authored`
 * holds every `id` an author wrote on the page (a field, a Step whose title is
 * plain text, a Card, an HTML element); each is reserved here, after the
 * headings are numbered, so a generated id never repeats one and no heading id
 * moves. An authored id itself is kept as written by the caller.
 */
export function numberFieldIds(bases: Iterable<string>, used: Set<string>, authored: Iterable<string>): Array<string> {
  for (const id of authored) used.add(id)
  return [...bases].map((base) => uniqueFieldId(base, used))
}

/** One `code` span in a title string; the backticks are markup, the text between them is what renders. */
const INLINE_CODE = /`([^`\n]+)`/g

/**
 * Split a title string (a component `title`, a page `description`) into plain
 * text and `inline code` runs, as Mintlify renders them. Renderers wrap the code
 * runs; anchors, outlines and meta tags read {@link plainInlineText}, so every
 * consumer agrees on what the title says.
 */
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

/** ASCII-only anchor normalization the `<Update>` timeline has always used. */
function normalizeUpdateId(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Anchor id of one `<Update>` changelog entry. The renderer (the `Update` MDX
 * component) and every machine projection (RSS, JSON Feed, MCP `list_changes`)
 * call this one function, so a feed item's `#anchor` always lands on the
 * rendered entry. An explicit `id` wins; otherwise the label is normalized
 * exactly as before (existing deep links keep working). A label with no ASCII
 * letters (e.g. a Japanese release name) falls back to the date, so the entry
 * is still linkable. Undefined when nothing usable remains.
 */
export function updateAnchorId(props: { id?: string; label?: string; date?: string }): string | undefined {
  if (props.id) return props.id
  const fromLabel = props.label ? normalizeUpdateId(props.label) : ''
  if (fromLabel) return fromLabel
  const fromDate = props.date ? normalizeUpdateId(props.date) : ''
  return fromDate || undefined
}

/**
 * Id of an `<Accordion>`'s `<details>`: the `id` its author gave, else its
 * title in the same ASCII kebab case. Undefined with neither (a title with no
 * ASCII letters, say), where the component falls back to a React id.
 */
export function accordionAnchorId(props: { id?: string; title?: string }): string | undefined {
  return props.id || normalizeUpdateId(plainInlineText(props.title ?? '')) || undefined
}

/** Id of the body of the `<Accordion>` whose own id is `accordionId`. */
export function accordionChildrenId(accordionId: string): string {
  return `${accordionId}-accordion-children`
}

/**
 * The ids a component gives its own elements from its literal attributes, which a
 * `<ParamField>` or `<ResponseField>` anchor must not repeat: an `<Accordion>`'s
 * (`accordionAnchorId`) and its body's, and an `<Update>`'s (`updateAnchorId`).
 * `attribute` reads one literal attribute as in `fieldAnchorName`; a value MDX
 * computes is unknown here, so the id it would make is not listed.
 * No other built-in component derives an id from text. The rest set none or take
 * a React `useId()` (`:r1:`, `_R_0_`), which never reads like a field's `param-…`.
 */
export function componentIds(tag: string, attribute: (name: string) => string | null | undefined): Array<string> {
  const literal = (name: string): string | undefined => {
    const value = attribute(name)
    return typeof value === 'string' ? value : undefined
  }
  // An `id` that is an expression holds something only the page knows, and it replaces the id the title or label would make.
  if (attribute('id') === null) return []
  if (tag === 'Accordion') {
    const id = accordionAnchorId({ id: literal('id'), title: literal('title') })
    return id ? [id, accordionChildrenId(id)] : []
  }
  if (tag === 'Update') {
    const id = updateAnchorId({ id: literal('id'), label: literal('label'), date: literal('date') })
    return id ? [id] : []
  }
  return []
}
