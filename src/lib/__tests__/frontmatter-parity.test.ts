/**
 * Every frontmatter parser in this repository must refuse to execute content.
 *
 * The helper is deliberately duplicated rather than shared. `packages/*` are
 * separately published units: importing one from another means a runtime
 * dependency, and `@thallylabs/core` is at 0.2.0 in this workspace while only
 * 0.1.0 exists on npm. Adding `@thallylabs/core@^0.2.0` to `mcp`, `migrate`,
 * or `create-thally-docs` — all of which ARE published at their current
 * versions — would produce packages that cannot install until core ships.
 * That is a worse failure than duplication.
 *
 * What duplication costs is silent drift: a fix applied to one copy and
 * forgotten in four. This test buys back the guarantee that matters. It walks
 * every copy and asserts the security property directly, so a new copy that
 * forgets the engine override, or an old copy quietly reverted to a bare
 * `matter()`, fails here rather than in production.
 *
 * When core 0.2.0 is published, collapse the copies and delete this test.
 */

import { describe, expect, it } from 'vitest'

import { parseFrontmatter as engineParse } from '@/lib/frontmatter'
import { parseFrontmatter as coreParse } from '../../../packages/core/src/content/frontmatter'
import { parseFrontmatter as mcpParse } from '../../../packages/mcp/src/lib/frontmatter'
import { parseFrontmatter as migrateParse } from '../../../packages/migrate/src/frontmatter'
import { parseFrontmatter as scaffoldParse } from '../../../packages/create-thally-docs/src/frontmatter'

const PARSERS: Array<[string, (raw: string) => { data: Record<string, unknown> }]> = [
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
    const { data } = parse('---\ntitle: Hello\n---\n\nBody.')
    expect(data.title).toBe('Hello')
  })
})
