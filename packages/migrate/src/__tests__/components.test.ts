/** Component migration preserves executable source without running source code. */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createComponentMigrator, mergeComponentRegistry } from '../components.js'
import { migrateRepository } from '../repository.js'
import { renderMigrationFiles } from '../render.js'
import type { MigrationWarning } from '../types.js'

const roots: Array<string> = []
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-components-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('repository component migration', () => {
  it('merges an authored registry without replacing its imports, comments, or overrides', () => {
    const existing = `/** Customer explanation */\nimport { Highlight } from './highlight'\nexport const customComponents = { Highlight } satisfies Record<string, unknown>\nexport const other = 42\n`
    const incoming = `export const customComponents = { Imported: () => null }\n`
    const merged = mergeComponentRegistry(existing, incoming)
    const registry = merged.find((file) => file.path === 'src/mdx/custom-components.tsx')!
    expect(registry.content).toContain('/** Customer explanation */')
    expect(registry.content).toContain("import { Highlight } from './highlight'")
    expect(registry.content).toMatch(/\.\.\.MigratedRegistry[a-f0-9]+, Highlight/)
    expect(registry.content).toContain('export const other = 42')
    expect(merged.find((file) => file.path.includes('migrated-components-'))?.content).toBe(incoming)
    expect(mergeComponentRegistry(String(registry.content), incoming)).toEqual(merged)
  })

  it('fails before rendering files when an existing registry cannot be merged safely', () => {
    expect(() => mergeComponentRegistry('export { customComponents } from "./registry"', 'export const customComponents = {}'))
      .toThrow('existing registry was preserved')
  })

  it('preserves the directive prologue of an existing client registry', () => {
    const files = mergeComponentRegistry("'use client';\nexport const customComponents = {}", 'export const customComponents = {}')
    expect(files.at(-1)?.content).toMatch(/^'use client';\nimport /)
  })

  it('imports implicit React globals without replacing explicit imports or local bindings', () => {
    const root = fixture({
      'implicit.jsx': `export default function Widget() { const [n] = useState(1); useEffect(() => {}, []); return React.createElement('p', null, n) }`,
      'explicit.jsx': `import { useState as useCounter, useEffect } from 'react'; const useState = () => [7]; export default function Widget() { const [n] = useState(); useEffect(() => {}, []); return <p>{n}</p> }`,
    })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    migrator.transform("import Implicit from './implicit.jsx'\nimport Explicit from './explicit.jsx'\n\n<Implicit />\n\n<Explicit />", join(root, 'index.mdx'))
    const implicit = migrator.files().find((file) => file.path.endsWith('/implicit.jsx'))!
    expect(implicit.content).toContain("import * as React from 'react'")
    expect(implicit.content).toContain("import { useEffect, useState } from 'react'")
    const explicit = migrator.files().find((file) => file.path.endsWith('/explicit.jsx'))!
    expect(String(explicit.content).match(/import /g)).toHaveLength(1)
    expect(warnings).toEqual([])
  })

  it('registers multiline named/default imports and copies their dependency graph once', () => {
    const root = fixture({
      'docs.json': JSON.stringify({ navigation: { pages: ['index'] } }),
      'index.mdx': `---\ntitle: Home\n---\nimport DefaultWidget, {\n  Counter as Visits,\n} from '/snippets/widget'\n\n<Visits initial={4} />\n\n<DefaultWidget>Children</DefaultWidget>`,
      'snippets/widget.tsx': `import { useState } from 'react';\nimport { label } from './label.js';\nexport const Counter = ({ initial = 0 }) => { const [n, setN] = useState(initial); return <button onClick={() => setN(n + 1)}>{label}: {n}</button> };\nexport default function Widget({ children }) { return <div>{children}</div> }`,
      'snippets/label.ts': `export { label } from './data';`,
      'snippets/data.ts': `export const label = 'Visits';`,
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://example.com/docs', platform: 'mintlify' })
    expect(bundle.warnings).toEqual([])
    const body = bundle.pages[0].body
    expect(body).not.toContain('import ')
    expect(body).not.toContain('<Visits')
    expect(body).toMatch(/<Migrated[a-f0-9]+ initial=\{4\} \/>/)
    expect(body).toMatch(/<Migrated[a-f0-9]+>Children<\/Migrated[a-f0-9]+>/)
    const files = renderMigrationFiles(bundle)
    expect(files.filter((file) => file.path.endsWith('/widget.tsx'))).toHaveLength(1)
    const widget = files.find((file) => file.path.endsWith('/widget.tsx'))!
    expect(widget.content).toContain("'use client';")
    expect(widget.content).toContain('"./label"')
    expect(files.find((file) => file.path === 'src/mdx/custom-components.tsx')?.content).not.toContain('widget.tsx')
    expect(files.find((file) => file.path === 'src/mdx/custom-components.tsx')?.content).toContain('Counter as Migrated')
    expect(files.find((file) => file.path === 'src/mdx/custom-components.tsx')?.content).toContain('default as Migrated')
  })

  it('keeps identically named imports page-local and leaves fenced examples untouched', () => {
    const root = fixture({ 'one.jsx': 'export default () => <p>One</p>', 'two.jsx': 'export default () => <p>Two</p>' })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const first = migrator.transform("import Widget from './one.jsx'\n\n<Widget />\n\n```jsx\nimport Widget from './missing.jsx'\n<Widget />\n```", join(root, 'one.mdx'))
    const second = migrator.transform("import Widget from './two.jsx'\n\n<Widget />", join(root, 'two.mdx'))
    expect(first.match(/<Migrated[^ ]+/)?.[0]).not.toBe(second.match(/<Migrated[^ ]+/)?.[0])
    expect(first).toContain("```jsx\nimport Widget from './missing.jsx'\n<Widget />\n```")
    expect(warnings).toEqual([])
  })

  it('extracts HTML event handlers into client JSX while preserving passive MDX', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const body = migrator.transform(`---\ntitle: Welcome\nmode: custom\n---\nexport function openSearch() { document.getElementById('search-bar-entry').click(); }\n\n<div><button onClick={openSearch}>Search docs</button></div>\n\n<CardGroup cols={2}>\n  <Card title="Start" href="/start">Read the guide</Card>\n</CardGroup>`, join(root, 'home.mdx'))
    expect(body).toContain('title: Welcome')
    expect(body).toContain('<CardGroup cols={2}>')
    expect(body).toMatch(/<Migrated[a-f0-9]+ \/>/)
    expect(body).not.toContain('onClick')
    expect(body).not.toContain('export function')
    const inline = migrator.files().find((file) => file.path.includes('/inline-'))!
    expect(inline.content).toContain("'use client'")
    expect(inline.content).toContain('onClick={openSearch}')
    expect(inline.content).toContain("new KeyboardEvent('keydown'")
    expect(warnings).toEqual([])
  })

  it('preserves shared declarations when passive page expressions still reference them', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const source = `export const label = 'Visible';\n\n<div onClick={() => {}}>{label}</div>\n\n{label}`
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings[0].message).toContain('shares declarations')
  })

  it.each([
    ["export const props = { title: 'Visible' };", '<Card {...props} />'],
    ["export const UI = { Card: () => <p>Visible</p> };", '<UI.Card />'],
    ["export const Widget = () => <p>Visible</p>;", '<Widget />'],
  ])('preserves shared declarations referenced through JSX spreads or component tags: %s', (declaration, usage) => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const source = `${declaration}\n\n<div onClick={() => {}}>Click</div>\n\n${usage}`
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings[0].message).toContain('shares declarations')
  })

  it.each([
    '{true && <Widget />}',
    '<Other as={Widget} />',
    '<Other {...{ component: Widget }} />',
    '<Widget.Item />',
    'export const Wrapped = () => <Widget />;\n\n<Wrapped />',
  ])('preserves an imported binding used outside a direct JSX tag: %s', (usage) => {
    const root = fixture({ 'widget.jsx': 'export default () => <p>Widget</p>' })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const source = `import Widget from './widget.jsx'\n\n${usage}`
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings[0].message).toContain('MDX expressions')
  })

  it('handles cycles without evaluating any source', () => {
    const root = fixture({
      'widget.jsx': "import './helper.js';\nthrow new Error('must never execute');\nexport default () => <div />;",
      'helper.js': "import './widget.jsx';\nexport const value = 1;",
    })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    expect(() => migrator.transform("import Widget from './widget.jsx'\n\n<Widget />", join(root, 'index.mdx'))).not.toThrow()
    expect(migrator.files()).toHaveLength(3)
    expect(warnings).toEqual([])
  })

  it.each([
    ['traversal', "import data from '../outside.js'"],
    ['external package', "import data from 'unavailable-package'"],
    ['computed import', 'const data = import(window.location.hash)'],
    ['missing dependency', "import data from './missing.js'"],
    ['server directive', "'use server'"],
  ])('warns and preserves unsupported %s source without a partial registry', (_name, dependency) => {
    const root = fixture({ 'widget.jsx': `${dependency};\nexport default () => <div />` })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const source = "import Widget from './widget.jsx'\n\n<Widget />"
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('manual migration')
  })

  it('rejects symlinked directories even when their leaf looks ordinary', () => {
    const root = fixture({})
    const outside = fixture({ 'widget.jsx': 'export default () => <div />' })
    symlinkSync(outside, join(root, 'linked'), 'dir')
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings)
    const source = "import Widget from './linked/widget.jsx'\n\n<Widget />"
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings[0].message).toContain('symbolic links')
  })
})
