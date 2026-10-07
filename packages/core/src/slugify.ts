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
