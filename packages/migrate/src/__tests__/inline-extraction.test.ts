/** A page's inline hook component moves to a client module together with what it uses. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createComponentMigrator } from '../components.js'
import type { MigrationWarning } from '../types.js'

const roots: Array<string> = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function extract(source: string, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'thally-inline-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const warnings: Array<MigrationWarning> = []
  const migrator = createComponentMigrator(root, root, warnings, 'https://github.com/example/docs')
  const body = migrator.transform(source, join(root, 'index.mdx'))
  const outputs = migrator.files()
  const client = outputs.find((file) => file.path.includes('/inline-'))
  return { body, client: client ? String(client.content) : undefined, outputs, warnings }
}

const COUNTER = 'export const Counter = () => {\n  const [n, setN] = useState(0)\n  return <button onClick={() => setN(n + 1)}><Label text={String(n)} /></button>\n}'
const LABEL = 'export const Label = ({ text }) => <em>{text}</em>'

describe('page-local dependencies of an extracted inline component', () => {
  it('moves a sibling component the extracted one renders (the reported repro)', () => {
    const { body, client, warnings } = extract(`${LABEL}\n\n${COUNTER}\n\n<Counter />\n`)
    expect(warnings).toEqual([])
    expect(client).toMatch(/^'use client';/)
    expect(client).toContain('export const Label')
    expect(client).toContain('export const Counter')
    expect(client!.indexOf('export const Label')).toBeLessThan(client!.indexOf('export const Counter'))
    // Label is the page's own component, never looked up among the built-ins.
    expect(client).not.toContain('builtinMdxComponents')
    expect(body).not.toContain('export const Label')
    expect(body).not.toContain('export const Counter')
    expect(body).toMatch(/<Migrated[a-f0-9]+ \/>/)
  })

  it('keeps a server-safe dependency in the page when the page renders it too, and copies it', () => {
    const { body, client, warnings } = extract(`${LABEL}\n\n${COUNTER}\n\n<Counter />\n\n<Label text="direct" />\n`)
    expect(warnings).toEqual([])
    expect(body).toContain('export const Label')
    expect(body).toContain('<Label text="direct" />')
    expect(client!.match(/export const Label/g)).toHaveLength(1)
    expect(client).toContain('export const Counter')
  })

  it('moves a dependency that itself uses hooks and lets the page keep rendering it', () => {
    const label = 'export const Label = () => {\n  const [on] = useState(true)\n  return <em>{String(on)}</em>\n}'
    const counter = 'export const Counter = () => <div><Label /></div>'
    // Counter has no hook of its own; the page renders the hook component directly.
    const { body, client, warnings } = extract(`${label}\n\n${counter}\n\n<Label />\n\n<Counter />\n`)
    expect(warnings).toEqual([])
    expect(body).not.toContain('export const Label')
    expect(body.match(/<Migrated[a-f0-9]+ \/>/g)).toHaveLength(1)
    expect(client).toContain('export const Label')
    expect(client).toContain("import { useState } from 'react'")
  })

  it('moves mutually recursive components once, in source order', () => {
    const source = [
      'export const A = ({ depth }) => {',
      '  const [open] = useState(true)',
      '  return open && depth > 0 ? <B depth={depth - 1} /> : null',
      '}',
      '',
      'export const B = ({ depth }) => <div><A depth={depth} /></div>',
      '',
      '<A depth={2} />',
    ].join('\n')
    const { body, client, warnings } = extract(source)
    expect(warnings).toEqual([])
    expect(client!.match(/export const A\b/g)).toHaveLength(1)
    expect(client!.match(/export const B\b/g)).toHaveLength(1)
    expect(client!.indexOf('export const A')).toBeLessThan(client!.indexOf('export const B'))
    expect(body).not.toContain('export const')
  })

  it('follows a dependency referenced only as a prop value', () => {
    const source = [
      LABEL, '',
      'export const Counter = () => {\n  const [n] = useState(0)\n  return <Card icon={Label} title={String(n)} />\n}', '',
      '<Counter />',
    ].join('\n')
    const { client, warnings } = extract(source)
    expect(warnings).toEqual([])
    expect(client).toContain('export const Label')
    expect(client).toContain('const { Card } = builtinMdxComponents;')
  })

  it('does not mistake a locally shadowed name for the page-level declaration', () => {
    const source = [
      'export const Label = () => <b>page level</b>', '',
      'export const Counter = ({ Label }) => {\n  const [n] = useState(0)\n  return <Label>{n}</Label>\n}', '',
      'export const Other = () => {\n  const [n] = useState(0)\n  const Label = () => <i>{n}</i>\n  return <Label />\n}', '',
      '<Counter Label="p" />\n\n<Other />\n',
    ].join('\n')
    const { body, client, warnings } = extract(source)
    expect(warnings).toEqual([])
    // The page-level Label is not what either component renders.
    expect(client).not.toContain('page level')
    expect(body).toContain('page level')
  })

  it('lets a page-local component win over a same-named built-in', () => {
    const source = [
      'export const Card = ({ children }) => <section className="mine">{children}</section>', '',
      'export const Counter = () => {\n  const [n] = useState(0)\n  return <Card>{n}</Card>\n}', '',
      '<Counter />',
    ].join('\n')
    const { client, warnings } = extract(source)
    expect(warnings).toEqual([])
    expect(client).toContain('className="mine"')
    expect(client).not.toContain('builtinMdxComponents')
  })

  it('copies helpers, data and meta the component uses and keeps them in the page', () => {
    const source = [
      "export const meta = { title: 'Docs' }",
      'export const items = [1, 2, 3]',
      'export function fmt(value) { return `#${value}` }', '',
      'export const Counter = () => {\n  const [n] = useState(0)\n  return <p>{meta.title}{items.map(fmt)}{n}</p>\n}', '',
      '<Counter />\n\n{items.length}',
    ].join('\n')
    const { body, client, warnings } = extract(source)
    expect(warnings).toEqual([])
    for (const declaration of ['export const meta', 'export const items', 'export function fmt']) {
      expect(body).toContain(declaration)
      expect(client).toContain(declaration)
    }
    expect(body).not.toContain('export const Counter')
  })

  it('moves a dependency that is a server-safe component only the moved code uses', () => {
    const { body } = extract(`${LABEL}\n\n${COUNTER}\n\n<Counter />\n`)
    expect(body).not.toContain('Label')
  })

  it('copies the imports the moved dependencies use, with paths valid from the client module', () => {
    const source = [
      "import clsx from 'clsx'",
      "import Icon from './icon.jsx'", '',
      "export const Label = ({ text }) => <em className={clsx('a')}><Icon />{text}</em>", '',
      COUNTER, '',
      '<Counter />',
    ].join('\n')
    const { body, client, outputs, warnings } = extract(source, { 'icon.jsx': 'export default function Icon() { return <i /> }' })
    expect(warnings).toEqual([])
    expect(client).toContain("import clsx from 'clsx'")
    const icon = outputs.find((file) => file.path.endsWith('/icon.jsx'))
    expect(icon).toBeDefined()
    expect(client).toContain(`from "@/${icon!.path.replace(/^src\//, '')}"`)
    expect(body).not.toContain('export const Label')
  })

  it('removes a React import from the page once only the moved code used it', () => {
    const { body, client } = extract(`import { useState } from 'react'\n\n${LABEL}\n\n${COUNTER}\n\n<Counter />\n`)
    expect(body).not.toContain("from 'react'")
    expect(client).toContain("import { useState } from 'react'")
  })

  it.each([
    ['export function declarations', 'export function Label({ text }) { return <em>{text}</em> }\n\nexport function Counter() {\n  const [n] = useState(0)\n  return <Label text={String(n)} />\n}'],
    ['function expressions', 'export const Label = function ({ text }) { return <em>{text}</em> }\n\nexport const Counter = function () {\n  const [n] = useState(0)\n  return <Label text={String(n)} />\n}'],
    ['class components', 'export class Label extends React.Component { render() { return <em>x</em> } }\n\nexport const Counter = () => {\n  const [n] = useState(0)\n  return <Label />\n}'],
    ['a memoised dependency', 'export const Label = React.memo(({ text }) => <em>{text}</em>)\n\nexport const Counter = () => {\n  const [n] = useState(0)\n  return <Label text={String(n)} />\n}'],
  ])('handles %s', (_name, declarations) => {
    const { body, client, warnings } = extract(`${declarations}\n\n<Counter />\n`)
    expect(warnings).toEqual([])
    expect(client).toContain('Label')
    expect(client).toContain('Counter')
    expect(body).not.toContain('export')
  })
})

describe('how the page reaches a moved component', () => {
  const both = `${LABEL}\n\n${COUNTER}\n\n`

  it('renders it inside an interactive root extracted by the page pass', () => {
    const { body, outputs, warnings } = extract(`${both}<div onClick={() => {}}><Counter /></div>\n`)
    expect(warnings).toEqual([])
    expect(body).toMatch(/<Migrated[a-f0-9]+ \/>/)
    const root = outputs.find((file) => String(file.content).includes('export function Inline0'))!
    expect(String(root.content)).toMatch(/import \{ Counter \} from "\.\/inline-[a-f0-9]+\.jsx"/)
  })

  it.each([
    ['a tag inside an expression', '{true && <Counter />}'],
    ['a prop value', '<Card icon={Counter}>x</Card>'],
    ['a kept page declaration', 'export const Wrap = () => <div><Counter /></div>\n\n<Wrap />'],
  ])('imports it by its own name for %s', (_name, usage) => {
    const { body, warnings } = extract(`${both}${usage}\n`)
    expect(warnings).toEqual([])
    expect(body).toMatch(/^import \{ Counter \} from "@\/mdx\/migrated\/[a-f0-9]+\/inline-[a-f0-9]+\.jsx";/)
    expect(body).not.toContain('export const Counter')
  })
})

describe('a dependency that cannot move safely keeps the whole component in place', () => {
  it.each([
    ['server-only process.env', 'export const Label = () => <em>{process.env.SECRET}</em>', 'process'],
    ['an async server component', 'export const Label = async () => { const r = await fetch("/x"); return <em>{r.status}</em> }', 'async'],
    ['an undeclared identifier', 'export const Label = () => <em>{mystery}</em>', 'mystery'],
    ['an unknown component', 'export const Label = () => <Mystery />', 'Mystery'],
    ['a dynamic import', 'export const Label = () => { import("./x.js"); return <em /> }', 'dynamic import'],
  ])('warns and leaves the page untouched for %s', (_name, label, blocker) => {
    const source = `${label}\n\n${COUNTER}\n\n<Counter />\n`
    const { body, client, warnings } = extract(source)
    expect(client).toBeUndefined()
    expect(body).toBe(source)
    const warning = warnings.find((entry) => entry.message.includes('"Counter"'))
    expect(warning?.message).toContain('left in the page')
    expect(warning?.message).toContain(blocker)
  })

  it('leaves a component whose dependency is read by server-side page code', () => {
    const counter = 'export const Counter = () => {\n  const [n] = useState(0)\n  return <p>{n}</p>\n}'
    const source = `${counter}\n\n{Counter.name}\n\n<Counter />\n`
    const { body, client, warnings } = extract(source)
    expect(client).toBeUndefined()
    expect(body).toBe(source)
    expect(warnings[0].message).toContain('"Counter"')
  })

  it('still extracts an unrelated component when another one is blocked', () => {
    const blocked = 'export const Bad = () => {\n  const [n] = useState(0)\n  return <em>{process.env.X}{n}</em>\n}'
    const good = 'export const Good = () => {\n  const [n] = useState(0)\n  return <b>{n}</b>\n}'
    const { body, client, warnings } = extract(`${blocked}\n\n${good}\n\n<Bad />\n\n<Good />\n`)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('"Bad"')
    expect(body).toContain('export const Bad')
    expect(body).not.toContain('export const Good')
    expect(client).toContain('export const Good')
    expect(client).not.toContain('Bad')
  })
})
