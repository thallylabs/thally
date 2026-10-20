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
