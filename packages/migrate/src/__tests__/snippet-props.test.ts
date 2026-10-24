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

describe('a snippet prop is bound only where it is a free variable', () => {
  it('leaves a name the snippet declares at the top of its own module alone', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': 'export const mode = "local";\n\n{mode === "local" && <span>Keep this</span>}\n',
    })
    expect(body).toContain('{mode === "local" && <span>Keep this</span>}')
    expect(body).not.toContain('"strict"')
  })

  it('leaves a name the snippet declares by function, class or import alone', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" other="x" third="y" />'),
      'snippets/role.mdx': [
        'import { mode } from "/snippets/values.js"',
        'export function other() { return 1 }',
        'export class third {}',
        '',
        '{mode === 1 && other() && <span>Keep this</span>}',
        '',
      ].join('\n'),
      'snippets/values.js': 'export const mode = 1',
    })
    expect(body).toContain('{mode === 1 && other() && <span>Keep this</span>}')
  })

  it('still binds a prop the snippet only reads through props', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': 'export const label = props.mode;\n\n{mode === "strict" && <span>{label}</span>}\n',
    })
    expect(body).toContain('export const label = "strict";')
    expect(body).toContain('{"strict" === "strict" && <span>{label}</span>}')
  })

  it('binds an outer reference when a callback in the same expression declares the same name', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{mode === "strict" && ["a", "b"].map((mode) => <li key={mode + "!"}>{mode.toUpperCase()}</li>)}\n',
    })
    expect(body).toContain('{"strict" === "strict" && ["a", "b"].map((mode) => <li key={mode + "!"}>{mode.toUpperCase()}</li>)}')
  })

  it('shadows a name only inside the function or block that declares it', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{(() => { const mode = 1; return mode })() && mode === "strict" && (() => { { const mode = 2 } return mode })()}\n',
    })
    expect(body).toContain('{(() => { const mode = 1; return mode })() && "strict" === "strict" && (() => { { const mode = 2 } return "strict" })()}')
  })
})


describe('a snippet binds props.name only where props itself is the snippet argument', () => {
  it('leaves props.mode alone when the snippet declares props at the top of its own module', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': 'export const props = { mode: "local" };\n\n{props.mode === "local" && <span>Keep this</span>}\n',
    })
    expect(body).toContain('{props.mode === "local" && <span>Keep this</span>}')
    expect(body).not.toContain('"strict"')
  })

  it('leaves props.mode alone inside a block that declares props', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{(() => { const props = { mode: "local" }; return props.mode === "local" && <span>Keep this</span> })()}\n',
    })
    expect(body).toContain('const props = { mode: "local" }; return props.mode === "local" && <span>Keep this</span>')
    expect(body).not.toContain('"strict"')
  })

  it('still binds the free variables of a function whose parameter is named props', () => {
    const { body, warnings } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{["a"].map((props) => <span key={props}>{mode + props + props.mode}</span>)}\n',
    })
    expect(body).toContain('{["a"].map((props) => <span key={props}>{"strict" + props + props.mode}</span>)}')
    expect(warnings.map((warning) => warning.message).join('\n')).not.toContain('Expressions that use')
  })
})

describe('a snippet prop is never bound to a class member name', () => {
  it('keeps the name of a method, field, accessor and private member, and binds a computed key', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': [
        '{(() => { class X { mode() { return "local" } }; return new X().mode() })()}',
        '',
        '{(() => { class Y { mode = 1; static mode = 2; get mode2() { return this.#mode } #mode = 3; static get mode3() { return W.#mode } }; class W { static #mode = 4 }; return [new Y().mode, Y.mode] })()}',
        '',
        '{(() => { class Z { [mode]() { return 1 } }; return new Z() })()}',
        '',
      ].join('\n'),
    })
    expect(body).toContain('class X { mode() { return "local" } }; return new X().mode()')
    expect(body).toContain('class Y { mode = 1; static mode = 2; get mode2() { return this.#mode } #mode = 3; static get mode3() { return W.#mode } }; class W { static #mode = 4 }')
    expect(body).toContain('class Z { ["strict"]() { return 1 } }')
  })

  it('still binds the prop where a class method reads it as a variable', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{(() => { class X { mode() { return mode } }; return new X().mode() })()}\n',
    })
    expect(body).toContain('class X { mode() { return "strict" } }; return new X().mode()')
  })
})

describe('a lone {name} in a snippet is bound by the same scope rules as any other use', () => {
  it('leaves {name} alone inside a callback that declares the name', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': '{["a"].map((mode) => <span key={mode}>{mode}</span>)}\n',
    })
    expect(body).toContain('(mode) => <span key={mode}>{mode}</span>')
    expect(body).not.toContain('"strict"')
  })

  it('leaves {name} alone where the snippet declares the name at the top of its own module', () => {
    const { body } = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': 'export const mode = "local";\n\nValue: {mode}\n\n<Card title={mode} />\n',
    })
    expect(body).toContain('Value: {mode}')
    expect(body).toContain('<Card title={mode} />')
    expect(body).not.toContain('"strict"')
  })

  it('still replaces {name} in text, an attribute, a markdown snippet and inline code', () => {
    const jsx = migrate({
      'home.mdx': page('<Role mode="strict" />'),
      'snippets/role.mdx': 'Mode: {mode}\n\n<Card title={mode} />\n\nRun `deploy {mode}`.\n',
    })
    expect(jsx.body).toContain('Mode: {"strict"}')
    expect(jsx.body).toContain('<Card title={"strict"} />')
    expect(jsx.body).toContain('`deploy {"strict"}`')
    const markdown = migrate({
      'home.mdx': page('<Role mode="strict">Inner text</Role>'),
      'snippets/role.mdx': 'Mode: {mode}, then {children}.\n\n```js\n{mode}\n```\n',
    })
    expect(markdown.body).toContain('Mode: strict, then Inner text.')
    expect(markdown.body).toContain('```js\n{mode}\n```')
  })
})

describe('a snippet prop is bound where scope analysis says a reference is free', () => {
  const bind = (snippet: string, attributes = 'mode="strict"', children = '') => migrate({
    'home.mdx': page(children ? `<Role ${attributes}>${children}</Role>` : `<Role ${attributes} />`),
    'snippets/role.mdx': snippet,
  }).body

  it('does not turn a label into a string, and binds the reference after it', () => {
    const body = bind('{(() => { mode: for (;;) { break mode; } return mode; })()}\n')
    expect(body).toContain('mode: for (;;) { break mode; } return "strict";')
  })

  it('binds the outer name in a default parameter that a var of the body does not shadow', () => {
    const body = bind('{((x = mode) => { var mode = "local"; return x; })()}\n')
    expect(body).toContain('(x = "strict") => { var mode = "local"; return x; }')
  })

  it('does not let a var in a class static block shadow the enclosing function', () => {
    const body = bind('{(() => { class C { static { var mode = "local"; } }; return mode })()}\n')
    expect(body).toContain('static { var mode = "local"; } }; return "strict"')
  })
})
