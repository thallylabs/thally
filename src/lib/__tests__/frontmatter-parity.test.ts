/**
 * Every frontmatter parser in this repository must refuse to execute content.
 *
 * The helper is deliberately duplicated because every `packages/*` unit is
 * independently published and several do not otherwise depend on core.
 *
 * What duplication costs is silent drift: a fix applied to one copy and
 * forgotten in four. This test buys back the guarantee that matters. It walks
 * every copy and asserts the security property directly, so a new copy that
 * accepts an executable engine fails here rather than in production.
 */

import { describe, expect, it } from 'vitest'

import { parseFrontmatter as engineParse } from '@/lib/frontmatter'
import { parseFrontmatter as coreParse } from '../../../packages/core/src/content/frontmatter'
import { parseFrontmatter as mcpParse } from '../../../packages/mcp/src/lib/frontmatter'
import { parseFrontmatter as migrateParse } from '../../../packages/migrate/src/frontmatter'
import { parseFrontmatter as scaffoldParse } from '../../../packages/create-thally-docs/src/frontmatter'

const PARSERS: Array<[
  string,
  (raw: string) => { content: string; data: Record<string, unknown> },
]> = [
  ['engine src/lib', engineParse],
  ['packages/core', coreParse],
  ['packages/mcp', mcpParse],
  ['packages/migrate', migrateParse],
  ['packages/create-thally-docs', scaffoldParse],
]

describe.each(PARSERS)('%s frontmatter parser', (name, parse) => {
  it('does not execute a javascript frontmatter block', () => {
    const marker = `__frontmatter_parity_${name.replace(/\W/g, '_')}__`
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    const { data } = parse(
      `---js\n{ title: ((globalThis['${marker}'] = 'executed'), 'Owned') }\n---\n\nBody.`,
    )

    expect(globals[marker]).toBeUndefined()
    expect(data.title).not.toBe('Owned')
  })

  it('does not execute an explicitly named javascript engine block', () => {
    const marker = `__frontmatter_parity_alias_${name.replace(/\W/g, '_')}__`
    const globals = globalThis as unknown as Record<string, unknown>
    delete globals[marker]

    parse(`---javascript\n{ title: ((globalThis['${marker}'] = 'executed'), 'Owned') }\n---\n\nB.`)

    expect(globals[marker]).toBeUndefined()
  })

  it('still reads ordinary YAML frontmatter', () => {
    const { content, data } = parse('---\ntitle: Hello\n---\n\nBody.')
    expect(data.title).toBe('Hello')
    expect(content.trim()).toBe('Body.')
  })

  it('keeps BOM and CRLF behavior aligned', () => {
    const { content, data } = parse('\ufeff--- yaml\r\ntitle: Hello\r\n---\r\nBody.\r\n')

    expect(data.title).toBe('Hello')
    expect(content).toBe('Body.\r\n')
  })
})
