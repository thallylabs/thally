/** The package's frontmatter parser must not be a code-execution sink. */

import { describe, expect, it } from 'vitest'

import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js'

describe('parseFrontmatter', () => {
  it('does not execute javascript frontmatter', () => {
    const marker = '__mcp_frontmatter_probe__'
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    const parsed = parseFrontmatter(
      `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Hi') }\n---\n\nBody.`,
    )

    expect(globals[marker]).toBeUndefined()
    expect(parsed.data.title).toBeUndefined()
  })

  it('round-trips the documented yaml frontmatter', () => {
    const raw = stringifyFrontmatter('Body.', { title: 'Hello' })
    const parsed = parseFrontmatter(raw)
    expect(parsed.data.title).toBe('Hello')
    expect(parsed.content.trim()).toBe('Body.')
  })
})
