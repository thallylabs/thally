export type PlaygroundDisplay = 'interactive' | 'simple' | 'none'

const MODES = new Set(['interactive', 'simple', 'none'])

/**
 * Mintlify's `playground` display: the page's own frontmatter wins over
 * docs.json `api.playground.display`; the default is `interactive`.
 * `auth` means "only for signed-in readers"; with no reader sign-in here it
 * fails closed to `simple`, never to a playground everyone can use.
 */
export function resolvePlaygroundDisplay(page: unknown, site: unknown): PlaygroundDisplay {
  for (const value of [page, site]) {
    const mode = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (MODES.has(mode)) return mode as PlaygroundDisplay
    if (mode === 'auth') return 'simple'
  }
  return 'interactive'
}
