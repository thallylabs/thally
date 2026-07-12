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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
