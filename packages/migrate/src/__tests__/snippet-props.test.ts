/** A Mintlify snippet reads the props it is called with as variables, so inlining one must keep the content they select. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileSync } from '@mdx-js/mdx'
import { describe, expect, it } from 'vitest'

import { migrateRepository } from '../index.js'

function migrate(files: Record<string, string>, docsRoot = '') {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-props-'))
  const all = { 'docs.json': JSON.stringify({ $schema: 'https://mintlify.com/docs.json', navigation: { pages: ['home'] } }), ...files }
  for (const [path, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, docsRoot, path)), { recursive: true })
    writeFileSync(join(root, docsRoot, path), body)
  }
  const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/acme/docs' })
  const body = bundle.pages.find((candidate) => candidate.id === 'home')!.body
  expect(() => compileSync(body, { format: 'mdx' }), body).not.toThrow()
  return { body, warnings: bundle.warnings }
}

const page = (usage: string) => `---\ntitle: Home\n---\n\nimport Role from '/snippets/role.mdx'\n\n${usage}\n`
const role = [
  'Create the role.',
  '',
  '{externalId === "required" && (',
  '  <Note>',
  '    Use the external ID **{externalId}**.',
  '  </Note>',
  ')}',
  '',
  '{externalId !== "required" && <span>No external ID</span>}',
  '',
].join('\n')

describe('a snippet that uses its props as variables', () => {
  it('keeps the content a prop selects, once per use and without a warning', () => {
    const { body, warnings } = migrate({
      'home.mdx': page('<Role externalId="required" />\n\n<Role externalId="optional" />'),
      'snippets/role.mdx': role,
    })
    expect(body).toContain('{"required" === "required" && (')
    expect(body).toContain('{"required" !== "required" && <span>No external ID</span>}')
    expect(body).toContain('{"optional" === "required" && (')
    expect(body).toContain('Use the external ID **{"required"}**.')
    expect(body).not.toMatch(/\bexternalId\b/)
    expect(warnings.map((warning) => warning.message).join('\n')).not.toContain('Expressions that use')
  })

  it('binds the prop inside an attribute expression and a shorthand property', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '<Card title={`Mode ${mode}`} />\n\n{JSON.stringify({ mode })}\n',
    })
    expect(body).toContain('title={`Mode ${"strict"}`}')
    expect(body).toContain('{JSON.stringify({ mode: "strict" })}')
  })

  it('leaves a name that the snippet declares or reads as a property alone', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{["a", "b"].map((mode) => <li key={mode + "!"}>{mode.toUpperCase()}</li>)}\n\n{Math.mode} {JSON.stringify({ mode: 1 })}\n',
    })
    expect(body).toContain('(mode) => <li key={mode + "!"}>{mode.toUpperCase()}</li>')
    expect(body).toContain('{Math.mode}')
    expect(body).toContain('{ mode: 1 }')
  })

  it('names an unresolved expression by its path inside the docs folder', () => {
    const { warnings } = migrate({
      'home.mdx': '---\ntitle: Home\n---\n\nShown: {missing === 1 && "yes"}\n',
    }, 'docs')
    expect(warnings.find((warning) => warning.message.startsWith('Expressions that use "missing"'))?.source).toBe('home.mdx')
  })
})
