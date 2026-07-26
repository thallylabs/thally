/**
 * The one frontmatter parser for authored content in this package.
 *
 * `gray-matter` dispatches on the language token of the opening delimiter, so
 * `---js` frontmatter reaches an engine whose parser is literally `eval`:
 * arbitrary code execution inside whatever process reads the file. Migration
 * input is scraped from third-party sites and repositories, so every parse
 * must route through this helper rather than calling `matter()` directly.
 *
 * `{ language: 'yaml' }` does NOT close the hole: the language declared by the
 * content wins over the option. Only replacing the JavaScript engines does.
 *
 * Internal module — deliberately not part of the package's public API. The
 * app-side original is `src/lib/frontmatter.ts`; the packages keep their own
 * copies because they cannot import from the app.
 */

import matter from 'gray-matter'

const FRONTMATTER_OPTIONS = {
  engines: {
    javascript: () => ({}),
    js: () => ({}),
  },
} as const

/** Parse frontmatter without any path that can execute the content. */
export function parseFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, FRONTMATTER_OPTIONS)
}
