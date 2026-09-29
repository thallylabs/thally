/**
 * End to end: a migrated page and the client module extracted from it compile
 * through the runtime's own MDX pipeline and render every component they use.
 */

import { compile } from '@mdx-js/mdx'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'

import { createComponentMigrator } from '../../packages/migrate/src/components'
import { injectScopedComponentReferences } from '../../scripts/lib/scoped-component-references'
import { rehypePlugins } from './rehype'
import { remarkPlugins } from './remark'

type Exports = Record<string, unknown>

const roots: Array<string> = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

async function nodeRequire(specifier: string): Promise<Exports> {
  return (await import(specifier)) as Exports
}

function run(code: string, modules: Record<string, Exports>): Exports {
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports: Exports = {}
  new Function('exports', 'require', output)(exports, (specifier: string) => {
    if (!(specifier in modules)) throw new Error(`Unexpected import ${specifier}`)
    return modules[specifier]
  })
  return exports
}

async function render(source: string): Promise<{ html: string; body: string; warnings: Array<string> }> {
  const root = mkdtempSync(join(tmpdir(), 'thally-inline-e2e-'))
  roots.push(root)
  const warnings: Array<{ message: string }> = []
  const migrator = createComponentMigrator(root, root, warnings as never, 'https://github.com/example/docs')
  const body = migrator.transform(source, join(root, 'index.mdx'))
  const react = await nodeRequire('react')
  const runtime = await nodeRequire('react/jsx-runtime')
  const base = { react, 'react/jsx-runtime': runtime }

  // Evaluate every generated client module, resolving the @/ alias and
  // sibling imports the way the bundler would.
  const clientFiles = migrator.files().filter((file) => file.path.startsWith('src/mdx/migrated/'))
  const modules: Record<string, Exports> = {}
  for (const file of clientFiles) {
    expect(String(file.content)).toMatch(/^'use client';/)
    const local: Record<string, Exports> = { ...base }
    for (const other of clientFiles) {
      if (other !== file) local[`./${other.path.split('/').pop()}`] = modules[other.path] ?? {}
    }
    modules[file.path] = run(String(file.content), local)
  }
  const pageModules: Record<string, Exports> = { ...base }
  for (const [path, exports] of Object.entries(modules)) pageModules[`@/${path.replace(/^src\//, '')}`] = exports

  const program = await compile(body, { outputFormat: 'program', remarkPlugins, rehypePlugins })
  const page = run(injectScopedComponentReferences(String(program)), pageModules)
  // The runtime resolves each Migrated<hash> tag through the customer registry.
  const components: Record<string, unknown> = {}
  const registry = migrator.files().find((file) => file.path === 'src/mdx/custom-components.tsx')
  for (const match of String(registry?.content ?? '').matchAll(/import \{ (\w+) as (Migrated\w+) \} from "\.\/([^"]+)"/g)) {
    components[match[2]] = modules[`src/mdx/${match[3]}`]?.[match[1]]
  }
  const Content = page.default as (props: { components: Record<string, unknown> }) => never
  return { html: renderToStaticMarkup(createElement(Content, { components })), body, warnings: warnings.map((entry) => entry.message) }
}

const LABEL = 'export const Label = ({ text }) => <em className="lbl">{text}</em>'
const COUNTER = 'export const Counter = () => {\n  const [n, setN] = useState(0)\n  return <button onClick={() => setN(n + 1)}><Label text={`count ${n}`} /></button>\n}'

describe('migrated inline components compile and render through the MDX pipeline', () => {
  it('renders a hook component together with the sibling component it uses', async () => {
    const { html, warnings } = await render(`${LABEL}\n\n${COUNTER}\n\n<Counter />\n`)
    expect(warnings).toEqual([])
    expect(html).toContain('<em class="lbl">count 0</em>')
  })

  it('renders the dependency directly on the page too', async () => {
    const { html } = await render(`${LABEL}\n\n${COUNTER}\n\n<Counter />\n\n<Label text="direct" />\n`)
    expect(html).toContain('count 0')
    expect(html).toContain('<em class="lbl">direct</em>')
  })

  it('renders a hook dependency the page also renders directly', async () => {
    const label = 'export const Label = () => {\n  const [on] = useState(true)\n  return <em className="lbl">{String(on)}</em>\n}'
    const counter = 'export const Counter = () => <div className="wrap"><Label /></div>'
    const { html } = await render(`${label}\n\n${counter}\n\n<Label />\n\n<Counter />\n`)
    expect(html.match(/<em class="lbl">true<\/em>/g)).toHaveLength(2)
  })

  it('renders mutually recursive components', async () => {
    const source = [
      'export const A = ({ depth }) => {',
      '  const [open] = useState(true)',
      '  return open && depth > 0 ? <B depth={depth - 1} /> : <i>end</i>',
      '}', '',
      'export const B = ({ depth }) => <div className="b"><A depth={depth} /></div>', '',
      '<A depth={2} />',
    ].join('\n')
    const { html } = await render(source)
    expect(html).toContain('<i>end</i>')
    expect(html.match(/class="b"/g)).toHaveLength(2)
  })

  it('renders when the page reaches the moved component by import', async () => {
    const { html } = await render(`${LABEL}\n\n${COUNTER}\n\n{true && <Counter />}\n`)
    expect(html).toContain('<em class="lbl">count 0</em>')
  })
})
