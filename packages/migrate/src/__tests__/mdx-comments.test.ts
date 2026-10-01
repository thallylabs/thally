/** Snippet replacement must never nest or corrupt an MDX `{/* ... *\/}` comment. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileSync } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

function migrate(page: string, snippets: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-comments-'))
  writeFileSync(join(root, 'docs.json'), JSON.stringify({ $schema: 'https://mintlify.com/docs.json', navigation: { pages: ['home'] } }))
  writeFileSync(join(root, 'home.mdx'), `---\ntitle: Home\n---\n\n${page}\n`)
  for (const [path, body] of Object.entries(snippets)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
  const body = bundle.pages.find((candidate) => candidate.id === 'home')!.body
  expect(() => compileSync(body, { format: 'mdx' }), body).not.toThrow()
  return { body, warnings: bundle.warnings }
}

const IMPORT = "import Extract from '/snippets/extract.mdx'\n\n"

describe('snippet replacement versus MDX comments', () => {
  it('leaves a resolvable snippet tag inside a multi-line comment untouched', () => {
    const { body } = migrate(`${IMPORT}{/* ### Hidden\n\n<Extract /> */}\n\nvisible`, { 'snippets/extract.mdx': 'Real {/* inner */} text' })
    expect(body).toContain('<Extract />')
    expect(body).not.toContain('Real')
  })

  it('does not nest a missing-snippet comment inside a one-line comment', () => {
    const { body, warnings } = migrate(`${IMPORT}{/* <Extract /> */}\n\nvisible`)
    expect(body).not.toContain('Missing imported snippet')
    expect(warnings.some((warning) => warning.code === 'missing-page')).toBe(false)
  })

  it('still comments out a missing snippet used at the top level', () => {
    const { body } = migrate(`${IMPORT}<Extract />\n\nvisible`)
    expect(body).toContain('{/* Missing imported snippet: /snippets/extract.mdx */}')
  })

  it('never lets a path containing a comment terminator close the comment early', () => {
    const { body } = migrate("import Odd from '/snippets/a*/b.mdx'\n\n<Odd />\n\nvisible")
    expect(body).not.toMatch(/\*\/[^}]/)
    expect(body).toContain('Missing imported snippet')
    const tag = migrate('<Snippet file="/snippets/a*/b.mdx" />\n\nvisible')
    expect(tag.body).toContain('Missing snippet')
  })

  it('replaces a tag between two adjacent comments without touching either', () => {
    const { body } = migrate(`${IMPORT}{/* a <Extract /> */}<Extract />{/* b <Extract /> */}\n\nvisible`)
    expect(body.match(/<Extract \/>/g)).toHaveLength(2)
    expect(body).toContain('Missing imported snippet')
  })

  it.each([
    ['{ /* <Extract /> */ }', 'spaced braces'],
    ['{/* <Extract /> */ }', 'trailing space'],
    ['{\n/* <Extract /> */\n}', 'multi-line'],
  ])('leaves a missing snippet inside %j alone (%s)', (comment) => {
    const { body } = migrate(`${IMPORT}${comment}\n\nvisible`)
    expect(body).not.toContain('Missing imported snippet')
    expect(body).toContain('<Extract />')
  })

  it('does not let a fenced snippet inlined before `*/}` leave the rest of the page unnormalized', () => {
    // Source of the localized Firecrawl acorn failure: the snippet's closing fence
    // became "``` */}", so the page's later `{#id}` heading was masked as code.
    const { body } = migrate(`${IMPORT}{/* ### Hidden\n\n<Extract /> */}\n\n## Next {#next}\n\nText.`, { 'snippets/extract.mdx': '```python\nprint(1)\n```' })
    expect(body).toContain('<a id="next"></a>')
  })

  it.each([
    ['inside a Tab', '<Tab title="Python"><Extract /></Tab>'],
    ['followed by text', '<Extract /> more text'],
    ['preceded by text', 'text <Extract />'],
  ])('keeps a fenced snippet valid when its tag is glued to other text (%s)', (_name, line) => {
    const { body } = migrate(`${IMPORT}${line}\n\n## Next {#next}\n\nText.`, { 'snippets/extract.mdx': '```python\nprint(1)\n```' })
    expect(body).toContain('<a id="next"></a>')
  })

  it('keeps a fenced <Snippet file> valid when glued to other text', () => {
    const { body } = migrate('text <Snippet file="/snippets/extract.mdx" /> more\n\n## Next {#next}\n\nText.', { 'snippets/extract.mdx': '```python\nprint(1)\n```' })
    expect(body).toContain('<a id="next"></a>')
  })

  it('leaves a tag inside a fenced block and inline code as literal text', () => {
    const { body } = migrate(`${IMPORT}\`\`\`mdx\n<Extract />\n\`\`\`\n\nUse \`<Extract />\` and \`{/* x */}\` here.`)
    expect(body).toContain('```mdx\n<Extract />\n```')
    expect(body).toContain('`<Extract />`')
    expect(body).toContain('`{/* x */}`')
  })

  it('compiles the verbatim Firecrawl v2 Python SDK block', () => {
    const { body } = migrate([
      "import ExtractPythonShort from '/snippets/v2/extract/short/python.mdx'",
      '',
      '{/* ### Extracting Structured Data from Websites',
      '',
      'To extract structured data from websites, use the `extract` method. It takes the URLs to extract data from, a prompt, and a schema as arguments.',
      '',
      '<ExtractPythonShort /> */}',
      '',
      '### Run an Agent',
    ].join('\n'))
    expect(body).toContain('### Run an Agent')
  })

  it('compiles the Firecrawl localized v1 variant (single comment, missing locale snippet, following <div id>)', () => {
    const { body } = migrate([
      "import ExtractPythonShort from '/snippets/es/v1/extract/short/python.mdx'",
      '',
      '{/* ### Extracci\u00f3n de datos estructurados de sitios web',
      '',
      'Para extraer datos estructurados, utiliza el m\u00e9todo `extract`.',
      '',
      '<ExtractPythonShort /> */}',
      '',
      '<div id="crawling-a-website-with-websockets">',
      '',
      'Texto.',
      '',
      '</div>',
    ].join('\n'))
    expect(body).toContain('crawling-a-website-with-websockets')
  })
})
