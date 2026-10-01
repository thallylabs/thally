/** An inlined snippet body must be fence-balanced: Mintlify compiles each snippet alone, so an unclosed fence ends at its EOF. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileSync } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

function migrate(page: string, snippets: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-fences-'))
  writeFileSync(join(root, 'docs.json'), JSON.stringify({ $schema: 'https://mintlify.com/docs.json', navigation: { pages: ['home'] } }))
  writeFileSync(join(root, 'home.mdx'), `---\ntitle: Home\n---\n\n${page}\n`)
  for (const [path, body] of Object.entries(snippets)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
  const body = bundle.pages.find((candidate) => candidate.id === 'home')!.body
  expect(() => compileSync(body, { format: 'mdx' }), body).not.toThrow()
  return body
}

const group = (inner: string) => `<CodeGroup>\n${inner}\n</CodeGroup>`
const one = (fence: string, name = 'python') => `${fence}${name} Python\nprint(1)\n`

describe('unclosed fences in inlined snippets', () => {
  it('keeps a CodeGroup of three unclosed-fence component snippets well formed', () => {
    const body = migrate(
      "import A from '/snippets/a.mdx'\nimport B from '/snippets/b.mdx'\nimport C from '/snippets/c.mdx'\n\n" + group('<A />\n<B />\n<C />'),
      { 'snippets/a.mdx': one('```'), 'snippets/b.mdx': one('```', 'javascript'), 'snippets/c.mdx': one('```', 'bash') },
    )
    expect(body.match(/^```$/gm)).toHaveLength(3)
    expect(body).toContain('</CodeGroup>')
  })

  it('balances <Snippet file> bodies', () => {
    const body = migrate(group('<Snippet file="a.mdx" />'), { 'snippets/a.mdx': one('```') })
    expect(body).toMatch(/print\(1\)\n```\n/)
  })

  it('balances a snippet nested two deep', () => {
    const body = migrate(
      "import A from '/snippets/a.mdx'\n\n" + group('<A />'),
      { 'snippets/a.mdx': "import B from '/snippets/b.mdx'\n\n<B />\n", 'snippets/b.mdx': one('```') },
    )
    expect(body.match(/^```$/gm)).toHaveLength(1)
  })

  it.each([
    ['~~~', '~~~'],
    ['````', '````'],
    ['   ```', '```'],
  ])('closes a %j fence with %j', (open, close) => {
    const body = migrate("import A from '/snippets/a.mdx'\n\n" + group('<A />'), { 'snippets/a.mdx': one(open) })
    expect(body).toContain(`print(1)\n${close}\n`)
  })

  it('closes a fence when the snippet has no trailing newline', () => {
    const body = migrate("import A from '/snippets/a.mdx'\n\n" + group('<A />'), { 'snippets/a.mdx': '```python\nprint(1)' })
    expect(body).toContain('print(1)\n```')
  })

  it('does not treat a fence line with an info string inside an open fence as a close', () => {
    const body = migrate("import A from '/snippets/a.mdx'\n\n" + group('<A />'), { 'snippets/a.mdx': '```md\n```python\nx\n' })
    expect(body).toMatch(/x\n```\n/)
    expect(body.match(/^```$/gm)).toHaveLength(1)
  })

  it('leaves a balanced snippet byte-identical', () => {
    const snippet = '```python Python\nprint(1)\n```'
    const body = migrate("import A from '/snippets/a.mdx'\n\n" + group('<A />'), { 'snippets/a.mdx': snippet })
    expect(body).toContain(`<CodeGroup>\n${snippet}\n</CodeGroup>`)
  })
})
