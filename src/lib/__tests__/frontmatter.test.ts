/**
 * Frontmatter parsing is a code-execution sink if it is done with
 * a parser that accepts executable language engines, so this file guards both
 * halves of the fix: the YAML-only helper stays inert, and legacy parser
 * dependencies cannot re-enter another source module.
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
    expect(parsed.content.trim()).toBe('Body.')
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

  it('accepts a BOM, CRLF delimiters, and explicit YAML tags', () => {
    const parsed = parseFrontmatter('\ufeff--- yml\r\ntitle: Hello\r\n---\r\nBody.\r\n')

    expect(parsed.data.title).toBe('Hello')
    expect(parsed.content).toBe('Body.\r\n')
  })

  it('does not treat a longer thematic break as frontmatter', () => {
    const raw = '----\ntitle: prose\n---\nBody.'

    expect(parseFrontmatter(raw)).toMatchObject({ content: raw, data: {} })
  })
})

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
  it('does not import gray-matter from source modules', () => {
    // Assembled from parts so this assertion does not match its own source
    // file; quoted on both sides so prose mentions of the package don't count.
    const specifier = new RegExp(`['"]${'gray' + '-matter'}['"]`)
    const files = SOURCE_ROOTS.flatMap(sourceFilesUnder)
    const offenders = files.filter((file) =>
      specifier.test(readFileSync(path.join(process.cwd(), file), 'utf8')),
    )

    // A scan that walked nothing would "pass"; assert it actually looked.
    expect(files.length).toBeGreaterThan(200)
    expect(offenders).toEqual([])
  })
})
