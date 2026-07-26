/**
 * The one frontmatter parser for customer-authored content.
 *
 * `gray-matter` dispatches on the language token of the opening delimiter, so
 * `---js` frontmatter reaches an engine whose parser is literally `eval`:
 * arbitrary code execution inside whatever process reads the file — a request
 * handler, or the prebuild container that holds deploy credentials. Every
 * `.mdx` byte here is authored by a customer, so every parse must route
 * through this helper rather than calling `matter()` directly.
 *
 * `{ language: 'yaml' }` does NOT close the hole: the language declared by the
 * content wins over the option. Only replacing the JavaScript engines does.
 * YAML — the documented, only supported format — is unaffected.
 *
 * Sibling copies exist in the workspace packages that cannot import from
 * `src/` (packages/core, packages/mcp, packages/create-thally-docs,
 * packages/migrate). `src/lib/__tests__/frontmatter.test.ts` asserts that
 * these helpers are the only modules in the repo importing `gray-matter`.
 */

import matter from 'gray-matter'

const FRONTMATTER_OPTIONS = {
  engines: {
    javascript: () => ({}),
    js: () => ({}),
  },
} as const

export type ParsedFrontmatter = matter.GrayMatterFile<string>

/** Parse frontmatter without any path that can execute the content. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  return matter(raw, FRONTMATTER_OPTIONS)
}

/** Re-emit a document with the given frontmatter, always as YAML. */
export function stringifyFrontmatter(body: string, data: Record<string, unknown>): string {
  return matter.stringify(body, data)
}
