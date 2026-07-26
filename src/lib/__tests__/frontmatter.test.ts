/**
 * Frontmatter parsing is a code-execution sink if it is done with
 * `gray-matter`'s defaults, so this file guards both halves of the fix: the
 * helper neutralizes the JavaScript engines, and no other module in the repo
 * parses frontmatter without it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, stringifyFrontmatter } from '@/lib/frontmatter'

describe('parseFrontmatter', () => {
  it('does not execute javascript frontmatter', () => {
    const marker = '__frontmatter_helper_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    const parsed = parseFrontmatter(
      `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
    )

    expect(globals[marker]).toBeUndefined()
    expect(parsed.data.title).toBeUndefined()
  })

  it('still parses the documented yaml frontmatter', () => {
    const parsed = parseFrontmatter('---\ntitle: Hello\ntags:\n  - one\n---\n\nBody.')
    expect(parsed.data.title).toBe('Hello')
    expect(parsed.data.tags).toEqual(['one'])
    expect(parsed.content.trim()).toBe('Body.')
  })

  it('round-trips through stringifyFrontmatter as yaml', () => {
    const raw = stringifyFrontmatter('Body.', { title: 'Hello' })
    expect(raw.startsWith('---\n')).toBe(true)
    expect(parseFrontmatter(raw).data.title).toBe('Hello')
  })
})

// The vulnerability was never the parser alone — it was call sites reaching
// for `gray-matter` directly. Adding a new one must fail here rather than in
// production.
const HARDENED_PARSERS = [
  'src/lib/frontmatter.ts',
  'packages/core/src/content/frontmatter.ts',
  'packages/create-thally-docs/src/frontmatter.ts',
  'packages/mcp/src/lib/frontmatter.ts',
  'packages/migrate/src/frontmatter.ts',
]

// Derived rather than listed so the next workspace package is covered the day
// it is added, not the day someone remembers to extend this array.
const SOURCE_ROOTS = [
  'src',
  'scripts',
  ...readdirSync(path.join(process.cwd(), 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/src`),
]

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js']

function sourceFilesUnder(root: string): Array<string> {
  const absolute = path.join(process.cwd(), root)
  const entries = readdirSync(absolute, { recursive: true }) as Array<string>
  return entries
    .filter((entry) => SOURCE_EXTENSIONS.includes(path.extname(entry)))
    .filter((entry) => !entry.split(path.sep).some((segment) => segment === 'node_modules' || segment === 'dist'))
    .map((entry) => path.posix.join(root, entry.split(path.sep).join('/')))
}

describe('frontmatter parsing call sites', () => {
  it('imports gray-matter only in the hardened parsers', () => {
    // Assembled from parts so this assertion does not match its own source
    // file; quoted on both sides so prose mentions of the package don't count.
    const specifier = new RegExp(`['"]${'gray' + '-matter'}['"]`)
    const files = SOURCE_ROOTS.flatMap(sourceFilesUnder)
    const offenders = files.filter((file) => {
      if (HARDENED_PARSERS.includes(file)) return false
      return specifier.test(readFileSync(path.join(process.cwd(), file), 'utf8'))
    })

    // A scan that walked nothing would "pass"; assert it actually looked.
    expect(files.length).toBeGreaterThan(200)
    expect(files).toEqual(expect.arrayContaining(HARDENED_PARSERS))
    expect(offenders).toEqual([])
  })
})
