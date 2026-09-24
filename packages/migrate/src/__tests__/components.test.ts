/** Component migration preserves executable source without running source code. */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'

import { createComponentMigrator, declarationsReferenceBrowserGlobal, hasAnyFunctionValuedProp, mergeComponentRegistry, propsTargetExtractedClientComponent, SCAFFOLD_PROVIDED_IMPORTS } from '../components.js'
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
  it('isolates components and inline handlers from different sources across sequential imports', () => {
    function source(pageName: string, label: string): string {
      return fixture({
        'docs.json': JSON.stringify({ navigation: { pages: [pageName] } }),
        [`${pageName}.mdx`]: `import Widget, { Counter } from './snippets/widget.jsx'\n\n<Widget />\n\n<Counter />`,
        'shared.mdx': `<button onClick={() => {}}>${label}</button>`,
        'snippets/widget.jsx': `export default () => <p>${label}</p>; export const Counter = () => <p>Counter ${label}</p>`,
      })
    }
    const first = migrateRepository({ repositoryDir: source('first', 'First'), sourceUrl: 'https://github.com/first/docs' })
    const second = migrateRepository({ repositoryDir: source('second', 'Second'), sourceUrl: 'https://github.com/second/docs' })
    const firstFiles = renderMigrationFiles(first)
    const firstRegistry = String(firstFiles.find((file) => file.path === 'src/mdx/custom-components.tsx')!.content)
    const secondFiles = renderMigrationFiles(second, { existingConfig: first.docsConfig, existingComponentRegistry: firstRegistry })
    const firstGraph = firstFiles.filter((file) => file.path.startsWith('src/mdx/migrated/'))
    const secondGraph = secondFiles.filter((file) => file.path.startsWith('src/mdx/migrated/'))
    expect(firstGraph.length).toBeGreaterThan(1)
    expect(secondGraph.length).toBeGreaterThan(1)
    expect(secondGraph.every((file) => !firstGraph.some((prior) => prior.path === file.path))).toBe(true)
    expect(first.pages.find((page) => page.id === 'first')!.body).not.toBe(second.pages.find((page) => page.id === 'second')!.body)
    expect(first.pages.find((page) => page.id === 'first')!.body.match(/Migrated[a-f0-9]+/g)).toHaveLength(2)
    expect(new Set(first.pages.find((page) => page.id === 'first')!.body.match(/Migrated[a-f0-9]+/g)).size).toBe(2)
    const mergedRegistry = String(secondFiles.find((file) => file.path === 'src/mdx/custom-components.tsx')!.content)
    for (const line of firstRegistry.split('\n').filter((line) => line.startsWith('import '))) expect(mergedRegistry).toContain(line)
    expect(mergedRegistry).toContain('...MigratedRegistry')
    expect(second.warnings).toEqual([])
  })

  it('keeps repeat imports stable across clone directories and equivalent GitHub URLs', () => {
    const files = {
      'site/docs.json': JSON.stringify({ navigation: { pages: ['introduction'] } }),
      'site/introduction.mdx': "import Widget from './widget.jsx'\n\n<div onClick={() => {}}><Widget /></div>",
      'site/widget.jsx': 'export default () => <p>Stable component</p>',
    }
    const first = migrateRepository({ repositoryDir: fixture(files), sourceUrl: 'https://github.com/Example/Docs.git' })
    const repeated = migrateRepository({ repositoryDir: fixture(files), sourceUrl: 'https://github.com/example/docs/tree/main/site' })
    expect(first.componentFiles).toEqual(repeated.componentFiles)
    expect(first.pages[0].body).toBe(repeated.pages[0].body)
    const inline = String(first.componentFiles!.find((file) => file.path.includes('/inline-'))!.content)
    expect(inline).toContain('"./source/widget.jsx"')
  })

  it('migrates local components imported by a Fern page (../../components from fern/pages/...)', () => {
    const root = fixture({
      'fern/fern.config.json': JSON.stringify({ organization: 'acme' }),
      'fern/docs.yml': [
        'navigation:',
        '  - section: Guides',
        '    contents:',
        '      - page: Cookbook',
        '        path: ./pages/guides/cookbook.mdx',
      ].join('\n'),
      'fern/pages/guides/cookbook.mdx': [
        '---',
        'title: Cookbook',
        '---',
        "import { CookbookHeader } from '../../components/cookbook-header'",
        '',
        '<CookbookHeader href="https://github.com/example/docs" />',
      ].join('\n'),
      'fern/components/cookbook-header.tsx': [
        "export const CookbookHeader = ({ href }: { href: string }) => <a href={href}>Open in GitHub</a>",
      ].join('\n'),
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs', platform: 'fern' })
    expect(bundle.warnings.filter((warning) => /Module not found|module not found/i.test(warning.message))).toEqual([])
    const files = renderMigrationFiles(bundle)
    const graph = files.filter((file) => file.path.startsWith('src/mdx/migrated/'))
    expect(graph.length).toBeGreaterThan(0)
    expect(graph.some((file) => String(file.content).includes('Open in GitHub'))).toBe(true)
  })

  it('migrates a Fern page whose companion import binding (an enum) is used inside a JSX prop expression', () => {
    // Mirrors cohere-developer-experience's `model-showcase.tsx`: one import
    // statement brings in both the rendered component (`ModelShowcase`, used
    // as a bare tag) and a value-only companion (`Capability`, used only via
    // `Capability.SafetyModes` inside a prop expression). The whole file is
    // local and copyable, so both bindings are migrated together and the
    // page is kept — excluding a page the migration can satisfy would be
    // the wrong tradeoff.
    const root = fixture({
      'fern/fern.config.json': JSON.stringify({ organization: 'acme' }),
      'fern/docs.yml': [
        'navigation:',
        '  - page: Welcome',
        '    path: ./pages/welcome.mdx',
        '  - page: Model',
        '    path: ./pages/model.mdx',
      ].join('\n'),
      'fern/pages/welcome.mdx': '---\ntitle: Welcome\n---\n\nHello.',
      'fern/pages/model.mdx': [
        '---',
        'title: Model',
        '---',
        "import { ModelShowcase, Capability } from '../components/model-showcase'",
        '',
        '<ModelShowcase model={{ capabilities: [Capability.Reasoning] }} />',
      ].join('\n'),
      'fern/components/model-showcase.tsx': [
        'export enum Capability { Reasoning }',
        'export const ModelShowcase = ({ model }: { model: { capabilities: Capability[] } }) => <p>{model.capabilities.length}</p>',
      ].join('\n'),
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs', platform: 'fern' })
    expect(bundle.pages.map((page) => page.id).sort()).toEqual(['model', 'welcome'])
    expect(bundle.warnings.filter((warning) => warning.code === 'skipped-file')).toEqual([])
    const modelPage = bundle.pages.find((page) => page.id === 'model')!
    expect(modelPage.body).not.toContain('../components/model-showcase')
    const graph = bundle.componentFiles ?? []
    expect(graph.some((file) => String(file.content).includes('enum Capability'))).toBe(true)
    expect(graph.some((file) => String(file.content).includes('ModelShowcase'))).toBe(true)
    // `Capability` (a TS enum, not a component) is registered into the same
    // MDX scope as `ModelShowcase` so `Capability.Reasoning` resolves inside
    // the page. `MDXComponents`' index signature expects every entry to be
    // component-shaped, which an enum structurally is not — asserting the
    // object literal (rather than typing each entry) keeps `tsc` clean
    // without excluding content the migration can otherwise satisfy.
    const registry = String(graph.find((file) => file.path === 'src/mdx/custom-components.tsx')!.content)
    expect(registry).toContain('Capability')
    expect(registry).toContain('ModelShowcase')
    expect(registry).toMatch(/}\s*as unknown as MDXComponents/)
    const check = ts.transpileModule(registry, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, noEmit: true },
      reportDiagnostics: true,
    })
    // transpileModule only checks syntax (no cross-file type info), so this
    // proves the cast parses as valid TS; the real type-check is exercised
    // by a live `next build` (see the E2E verification, not run in unit tests).
    expect(check.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toBe(false)
  })

  it('separates sibling documentation roots within the same repository', () => {
    const files = Object.fromEntries(['first', 'second'].flatMap((directory) => [
      [`${directory}/docs.json`, JSON.stringify({ navigation: { pages: ['introduction'] } })],
      [`${directory}/introduction.mdx`, `<button onClick={() => {}}>${directory}</button>`],
    ]))
    const repositoryDir = fixture(files)
    const first = migrateRepository({ repositoryDir, sourceUrl: 'https://github.com/example/docs', docsDir: 'first' })
    const second = migrateRepository({ repositoryDir, sourceUrl: 'https://github.com/example/docs', docsDir: 'second' })
    expect(first.componentFiles![0].path).not.toBe(second.componentFiles![0].path)
  })

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
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
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
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const first = migrator.transform("import Widget from './one.jsx'\n\n<Widget />\n\n```jsx\nimport Widget from './missing.jsx'\n<Widget />\n```", join(root, 'one.mdx'))
    const second = migrator.transform("import Widget from './two.jsx'\n\n<Widget />", join(root, 'two.mdx'))
    expect(first.match(/<Migrated[^ ]+/)?.[0]).not.toBe(second.match(/<Migrated[^ ]+/)?.[0])
    expect(first).toContain("```jsx\nimport Widget from './missing.jsx'\n<Widget />\n```")
    expect(warnings).toEqual([])
  })

  it('extracts HTML event handlers into client JSX while preserving passive MDX', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const body = migrator.transform(`---\ntitle: Welcome\nmode: custom\n---\nexport function openSearch() { document.getElementById('search-bar-entry').click(); }\n\n<div><button onClick={openSearch}>Search docs</button></div>\n\n<CardGroup cols={2}>\n  <Card title="Start" href="/start">Read the guide</Card>\n</CardGroup>`, join(root, 'home.mdx'))
    expect(body).toContain('title: Welcome')
    expect(body).toContain('<CardGroup cols={2}>')
    expect(body).toMatch(/<Migrated[a-f0-9]+ \/>/)
    expect(body).not.toContain('onClick')
    expect(body).not.toContain('export function')
    const inline = migrator.files().find((file) => file.path.includes('/inline-'))!
    // Exactly one directive, and it must lead the file, or Next rejects the
    // module ("use client" must be the first statement).
    expect(String(inline.content).match(/'use client'/g)).toHaveLength(1)
    expect(inline.content).toMatch(/^'use client';/)
    expect(inline.content).toContain('onClick={openSearch}')
    expect(inline.content).toContain("new KeyboardEvent('keydown'")
    expect(warnings).toEqual([])
  })

  it('extracts a page-local stateful declaration invoked via a bare tag, so its hooks resolve in the client module', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    // Mintlify makes `useState` available without import inside inline
    // MDX-declared components. The invocation tag `<Counter />` itself has no
    // `onClick`, so nothing about its own JSX marks it interactive — only the
    // declaration body does. Left inline, this compiles into the page's own
    // server-rendered module, where `useState` is never in scope.
    const source = `export const Counter = () => {\n  const [count, setCount] = useState(0)\n  return <button onClick={() => setCount(count + 1)}>{count}</button>\n}\n\n<Counter />`
    const body = migrator.transform(source, join(root, 'index.mdx'))
    expect(body).not.toContain('export const Counter')
    expect(body).toMatch(/<Migrated[a-f0-9]+ \/>/)
    const inline = migrator.files().find((file) => file.path.includes('/inline-'))!
    expect(inline.content).toContain("import { useState } from 'react'")
    expect(String(inline.content).match(/'use client'/g)).toHaveLength(1)
    expect(inline.content).toMatch(/^'use client';/)
    expect(warnings).toEqual([])
  })

  it('preserves shared declarations when passive page expressions still reference them', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
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
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
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
  ])('copies and rewrites a local import even when a binding is used outside a direct JSX tag: %s', (usage) => {
    // A local/relative import is fully owned by the migration: the file is
    // copied and the import specifier rewritten, keeping every binding's
    // original local name — nothing in the page body needs renaming, so how
    // a binding is used (a bare tag, a prop value, a member tag, a wrapping
    // declaration, ...) makes no difference. Excluding the page here would
    // drop content the migration can actually satisfy.
    const root = fixture({ 'widget.jsx': 'export default () => <p>Widget</p>' })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = `import Widget from './widget.jsx'\n\n${usage}`
    const body = migrator.transform(source, join(root, 'index.mdx'))
    expect(body).not.toContain("from './widget.jsx'")
    expect(body).toContain(usage)
    // The copied component plus the always-generated component registry.
    expect(migrator.files()).toHaveLength(2)
    expect(warnings).toEqual([])
  })

  it('excludes the page only when the local component copy genuinely fails', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    // './missing.jsx' does not exist on disk, so `resolveDependency` throws;
    // that is a genuine copy failure, distinct from any usage pattern.
    const source = "import Widget from './missing.jsx'\n\n<Widget />"
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'skipped-file', message: expect.stringContaining('could not be copied') }))
  })

  it('handles cycles without evaluating any source', () => {
    const root = fixture({
      'widget.jsx': "import './helper.js';\nthrow new Error('must never execute');\nexport default () => <div />;",
      'helper.js': "import './widget.jsx';\nexport const value = 1;",
    })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
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
  ])('excludes the page (without a partial registry) when a dependency makes the copy fail: %s', (_name, dependency) => {
    const root = fixture({ 'widget.jsx': `${dependency};\nexport default () => <div />` })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import Widget from './widget.jsx'\n\n<Widget />"
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('skipped-file')
    expect(warnings[0].message).toContain('could not be copied')
  })

  it('removes an unsupported npm-package MDX import and replaces its usage instead of shipping a broken build', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import LiteYouTubeEmbed from 'react-lite-youtube-embed';\n\n<LiteYouTubeEmbed id=\"3YDiloj8_d0\" />"
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).not.toContain('react-lite-youtube-embed')
    expect(result).not.toContain('LiteYouTubeEmbed')
    expect(result).toContain('<iframe')
    expect(result).toContain('3YDiloj8_d0')
    expect(warnings).toEqual([expect.objectContaining({
      code: 'unsupported-config',
      message: expect.stringContaining("'react-lite-youtube-embed'"),
      source: 'index.mdx',
    })])
  })

  it('does not embed a YouTube iframe for an unrelated player package, even when its usage looks video-shaped', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    // "VimeoEmbed"/"react-vimeo-embed" match the old, too-broad
    // `video|embed|player` heuristic, but Vimeo ids don't resolve on
    // youtube.com, so this must fall back to the comment stub, not a
    // silently-broken (or wrong-video) iframe.
    const source = "import VimeoEmbed from 'react-vimeo-embed';\n\n<VimeoEmbed id=\"12345678\" />"
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).not.toContain('<iframe')
    expect(result).toContain("{/* Removed <VimeoEmbed>: unsupported import 'react-vimeo-embed' */}")
  })

  it('rejects an id that is not a bare YouTube video id instead of interpolating it unescaped', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = 'import LiteYouTubeEmbed from \'react-lite-youtube-embed\';\n\n<LiteYouTubeEmbed id="x onerror=alert(1)" />'
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('onerror')
    expect(result).toContain("unsupported import 'react-lite-youtube-embed'")
  })

  it('does not embed a JSX-expression id, since its literal source text is not the runtime value', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import LiteYouTubeEmbed from 'react-lite-youtube-embed';\n\nconst videoId = '3YDiloj8_d0';\n\n<LiteYouTubeEmbed id={videoId} />"
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).not.toContain('<iframe')
    expect(result).toContain("unsupported import 'react-lite-youtube-embed'")
  })

  it('embeds a YouTube URL passed to react-player, extracting the video id', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import ReactPlayer from 'react-player';\n\n<ReactPlayer url=\"https://www.youtube.com/watch?v=3YDiloj8_d0\" />"
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).toContain('<iframe')
    expect(result).toContain('3YDiloj8_d0')
  })

  it('replaces a non-video unsupported import usage with a comment naming the removed component and package', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import Confetti from 'react-confetti';\n\n<Confetti pieces={200} />"
    const result = migrator.transform(source, join(root, 'index.mdx'))
    expect(result).toBe("\n\n{/* Removed <Confetti>: unsupported import 'react-confetti' */}")
  })

  it('resolves a @site/... component import to its copied file, same as a relative import', () => {
    const root = fixture({ 'src/components/Widget.jsx': 'export default () => <p>Widget</p>' })
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const result = migrator.transform("import Widget from '@site/src/components/Widget.jsx'\n\n<Widget />", join(root, 'docs', 'index.mdx'))
    expect(result.trim()).toMatch(/^<Migrated[a-f0-9]+ \/>$/)
    expect(migrator.files().some((file) => file.path.endsWith('/Widget.jsx'))).toBe(true)
    expect(warnings).toEqual([])
  })

  it('rejects symlinked directories even when their leaf looks ordinary', () => {
    const root = fixture({})
    const outside = fixture({ 'widget.jsx': 'export default () => <div />' })
    symlinkSync(outside, join(root, 'linked'), 'dir')
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const source = "import Widget from './linked/widget.jsx'\n\n<Widget />"
    expect(migrator.transform(source, join(root, 'index.mdx'))).toBe(source)
    expect(migrator.files()).toEqual([])
    expect(warnings[0].message).toContain('symbolic links')
  })
  it('marks the page skipped-file when an unsupported npm import binding is referenced outside JSX', () => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    // `date-fns` is not local (doesn't start with '.' or '/') and is not an
    // installed shared/theme import; `format` is referenced inside a prop
    // expression (not bare JSX usage), so it can't be rewritten. Preserving
    // this import would fail `next build` site-wide with "Module not found".
    migrator.transform(
      "import { format } from 'date-fns'\n\n<Note label={format(new Date(), 'PP')} />",
      join(root, 'page.mdx'),
    )
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'skipped-file',
      source: 'page.mdx',
      message: expect.stringContaining("'date-fns'"),
    }))
    expect(warnings.find((warning) => warning.code === 'skipped-file')?.message).toContain('format')
  })
})

describe('propsTargetExtractedClientComponent', () => {
  it('is true when a declared name is passed as a bare prop to a Migrated<hash> tag', () => {
    const body = '<Migrated0123456789ab RenderComponent={CustomBlock} />'
    expect(propsTargetExtractedClientComponent(body, new Set(['CustomBlock']))).toBe(true)
  })

  it('is true for an inline-extracted Inline<n> tag', () => {
    const body = '<Inline0 onClick={handleClick} />'
    expect(propsTargetExtractedClientComponent(body, new Set(['handleClick']))).toBe(true)
  })

  it('is true for a Thally built-in already backed by a use-client module (CLIENT_BUILTIN_COMPONENT_TAGS)', () => {
    const body = '<Accordion RenderComponent={CustomBlock} />'
    expect(propsTargetExtractedClientComponent(body, new Set(['CustomBlock']))).toBe(true)
  })

  it('is false when the tag is neither extracted nor a confirmed client built-in, even with a matching prop', () => {
    const body = '<Steps RenderComponent={CustomBlock} />'
    expect(propsTargetExtractedClientComponent(body, new Set(['CustomBlock']))).toBe(false)
  })

  it('is false when no declared name matches the prop value', () => {
    const body = '<Migrated0123456789ab RenderComponent={SomethingElse} />'
    expect(propsTargetExtractedClientComponent(body, new Set(['CustomBlock']))).toBe(false)
  })

  it('is false when declaredNames is empty', () => {
    const body = '<Migrated0123456789ab RenderComponent={CustomBlock} />'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(false)
  })

  it('is true for an inline arrow function passed as a prop to a confirmed client built-in', () => {
    const body = '<Accordion title="t" onToggle={() => console.log(1)}>x</Accordion>'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(true)
  })

  it('is true for an inline `function` expression passed as a prop to a confirmed client built-in', () => {
    const body = '<Accordion title="t" onToggle={function () { console.log(1) }}>x</Accordion>'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(true)
  })

  it('is false for an inline arrow function on a tag that is neither extracted nor a confirmed client built-in', () => {
    const body = '<Steps onToggle={() => console.log(1)}>x</Steps>'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(false)
  })

  it('ignores an inline arrow function shown inside a fenced code sample', () => {
    const body = '```jsx\n<Accordion onToggle={() => console.log(1)} />\n```'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(false)
  })

  it('ignores JSX written inside a page-local export const, since remark-mdx parses it as ESM text, not JSX element nodes', () => {
    const body = 'export const Widget = () => <Accordion onToggle={() => console.log(1)} />;\n\n<Widget />'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(false)
  })

  it('is false for a value prop that merely looks like an object, not a function', () => {
    const body = '<Accordion data={{ a: 1 }} />'
    expect(propsTargetExtractedClientComponent(body, new Set())).toBe(false)
  })

  it('is true for a function passed as children to a confirmed client built-in', () => {
    expect(propsTargetExtractedClientComponent("<Accordion title=\"t\">{() => 'x'}</Accordion>", new Set())).toBe(true)
    expect(propsTargetExtractedClientComponent('<Accordion title="t">\n{render}\n</Accordion>', new Set(['render']))).toBe(true)
  })

  it('is false for ordinary expression children and identifiers that merely start with a keyword', () => {
    expect(propsTargetExtractedClientComponent('<Accordion title="t">{items.map((item) => item)}</Accordion>', new Set())).toBe(false)
    expect(propsTargetExtractedClientComponent('<Tabs items={functionList}>x</Tabs>', new Set())).toBe(false)
    expect(propsTargetExtractedClientComponent('<Accordion title={asyncMode}>x</Accordion>', new Set())).toBe(false)
    expect(propsTargetExtractedClientComponent('<Accordion title={classNames}>x</Accordion>', new Set())).toBe(false)
  })
})

describe('hasAnyFunctionValuedProp', () => {
  it('is true for an inline function prop even on an unconfirmed tag (the broader, unconfirmed signal)', () => {
    const body = '<Steps onToggle={() => console.log(1)}>x</Steps>'
    expect(hasAnyFunctionValuedProp(body, new Set())).toBe(true)
  })

  it('is true for a declared-name function prop on any tag', () => {
    const body = '<Widget render={CustomBlock} />'
    expect(hasAnyFunctionValuedProp(body, new Set(['CustomBlock']))).toBe(true)
  })

  it('is false when no prop carries a function value', () => {
    const body = '<Widget title="hi" count={1} />'
    expect(hasAnyFunctionValuedProp(body, new Set())).toBe(false)
  })
})

describe('declarationsReferenceBrowserGlobal', () => {
  it('is true for a page-local inline declaration that uses document', () => {
    const body = "export function Demo() {\n  return createPortal(children, document.body)\n}\n\n<Demo />"
    expect(declarationsReferenceBrowserGlobal(body)).toBe(true)
  })

  it('is false for a declaration that never references document or window', () => {
    const body = 'export const Demo = () => <div>hi</div>\n\n<Demo />'
    expect(declarationsReferenceBrowserGlobal(body)).toBe(false)
  })

  it('is false once the declaration is extracted into a client module (no inline mdxjsEsm left)', () => {
    const body = '<Inline0 />'
    expect(declarationsReferenceBrowserGlobal(body)).toBe(false)
  })
})

describe('scaffold-provided imports are kept untouched', () => {
  it.each([
    ['next/link used only as JSX', "import Link from 'next/link'\n\n<Link href=\"/a\">A</Link>", "import Link from 'next/link'"],
    ['next/link used both as JSX and referenced from a declaration', "import Link from 'next/link'\n\nexport const Nav = () => <Link href=\"/a\">A</Link>\n\n<Nav />", "import Link from 'next/link'"],
    ['clsx used only in an expression', "import clsx from 'clsx'\n\n<div className={clsx('a', 'b')}>hi</div>", "import clsx from 'clsx'"],
    ['lucide-react icon passed as a prop', "import { Rocket } from 'lucide-react'\n\n<Card icon={Rocket}>x</Card>", "import { Rocket } from 'lucide-react'"],
    ['react-dom used in a declaration', "import { createPortal } from 'react-dom'\n\nexport const P = ({children}) => createPortal(children, document.body)\n\n<P>x</P>", "import { createPortal } from 'react-dom'"],
    ['lucide-react subpath', "import { DynamicIcon } from 'lucide-react/dynamic'\n\n<DynamicIcon name=\"x\" />", "import { DynamicIcon } from 'lucide-react/dynamic'"],
    ['clsx subpath used in an expression', "import clsx from 'clsx/lite'\n\n<div className={clsx('a')}>x</div>", "import clsx from 'clsx/lite'"],
  ])('%s', (_label, source, expectedImport) => {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const body = migrator.transform(source, join(root, 'page.mdx'))
    expect(body).toBe(source)
    expect(body).toContain(expectedImport)
    expect(migrator.files()).toEqual([])
    expect(warnings).toEqual([])
  })
})

it('treats react-dom/server as unavailable, since Next makes its string renderers throw', () => {
  const root = fixture({})
  const warnings: Array<MigrationWarning> = []
  const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
  migrator.transform("import { renderToString } from 'react-dom/server'\n\n{renderToString(<b/>)}", join(root, 'page.mdx'))
  expect(warnings).toContainEqual(expect.objectContaining({ code: 'skipped-file', message: expect.stringContaining("'react-dom/server'") }))
})

describe('scaffold-provided imports in extracted client modules', () => {
  function extract(source: string): { page: string; clientModule: string; warnings: Array<MigrationWarning> } {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    const page = migrator.transform(source, join(root, 'page.mdx'))
    const clientModule = String(migrator.files().find((file) => file.path.includes('/inline-'))?.content ?? '')
    return { page, clientModule, warnings }
  }

  it('copies a clsx import into the client module alongside a stateful inline component', () => {
    const source = "import clsx from 'clsx'\nimport { useState } from 'react'\n\n"
      + "export const T = () => { const [on, set] = useState(false); return <button className={clsx(on && 'on')} onClick={() => set(!on)}>t</button> }\n\n<T />"
    const { page, clientModule, warnings } = extract(source)
    expect(clientModule).toContain("import clsx from 'clsx'")
    expect(clientModule).toContain('export const T')
    expect(page).toContain("import clsx from 'clsx'")
    expect(warnings).toEqual([])
  })

  it('copies a next/navigation hook import into the client module', () => {
    const source = "import { usePathname } from 'next/navigation'\n\nexport const P = () => <b>{usePathname()}</b>\n\n<P />"
    const { clientModule } = extract(source)
    expect(clientModule).toContain("import { usePathname } from 'next/navigation'")
  })
})

describe('source-site @/ path aliases', () => {
  function run(source: string): { body: string; warnings: Array<MigrationWarning> } {
    const root = fixture({})
    const warnings: Array<MigrationWarning> = []
    const migrator = createComponentMigrator(root, warnings, 'https://github.com/example/docs')
    return { body: migrator.transform(source, join(root, 'page.mdx')), warnings }
  }

  it('drops an unresolvable @/ component import used only as JSX and replaces its usage', () => {
    const { body, warnings } = run("import Hero from '@/components/HomepageHero'\n\n<Hero />")
    expect(body).not.toContain('import Hero')
    expect(body).toContain("{/* Removed <Hero>: unsupported import '@/components/HomepageHero' */}")
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'unsupported-config', message: expect.stringContaining('path alias') }))
  })

  it('excludes a page that uses an @/ import outside JSX', () => {
    const { warnings } = run("import { features } from '@/data/features'\n\n{features.length} features")
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'skipped-file', message: expect.stringContaining("the path alias '@/data/features'") }))
  })
})

describe('SCAFFOLD_PROVIDED_IMPORTS drift guard', () => {
  // The starter's package.json is starter-owned: `starter-runtime-contract.mjs`
  // only syncs the `@thallylabs/core` pin into it, not this repo's root
  // dependencies. What the contract does sync byte-for-byte is the runtime
  // (FRAMEWORK_SYNC_ELIGIBLE: src/app, src/components, src/lib, ...), so a
  // package that synced runtime code imports must be installed by the starter
  // or the starter itself would not build. Both checks below are local proxies
  // for the starter's real package.json, which lives in another repository.
  it('every listed package is a root runtime dependency imported by synced runtime code', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { FRAMEWORK_SYNC_ELIGIBLE } = await import('../../../../.github/scripts/starter-runtime-contract.mjs')
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    const dependencies = new Set(Object.keys(rootPackageJson.dependencies ?? {}))
    const runtimeDirs = ['src/app', 'src/components', 'src/lib']
    for (const dir of runtimeDirs) expect(FRAMEWORK_SYNC_ELIGIBLE).toContain(`${dir}/**`)
    const runtimeSource = runtimeDirs.flatMap((dir) => readdirSync(join(repoRoot, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))).join('\n')
    for (const name of SCAFFOLD_PROVIDED_IMPORTS) {
      expect(dependencies.has(name), `${name} is not in root package.json dependencies`).toBe(true)
      expect(new RegExp(`from ['"]${name}(?:/[^'"]*)?['"]`).test(runtimeSource), `${name} is not imported by synced runtime code`).toBe(true)
    }
  })
})
