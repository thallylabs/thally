/**
 * Move repository-owned MDX components into the customer component registry.
 * Source is parsed, never evaluated. Every dependency must remain inside the
 * documentation root and traverse only ordinary files (including its parents).
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import ts from 'typescript'
import { unified } from 'unified'

import { parseFrontmatter } from './frontmatter.js'
import { isFunctionInitializer, normalizeHtmlComments } from './mdx.js'
import { resolveWithin } from './path.js'
import type { MigrationWarning, RenderedMigrationFile } from './types.js'

interface MdxNode {
  type: string
  name?: string | null
  value?: string
  attributes?: Array<{
    name?: string
    type: string
    value?: string | { value?: string } | null
    position?: { start: { offset?: number }; end: { offset?: number } }
  }>
  children?: Array<MdxNode>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

interface Replacement { start: number; end: number; value: string }
interface Binding { local: string; imported: string; source: string }

/** A bare `id`/`videoId`-style attribute value is safe to embed in an `iframe src` only when it looks like a real YouTube video id. */
const YOUTUBE_VIDEO_ID = /^[\w-]{1,64}$/
/** Packages known to take a literal YouTube video id prop (as opposed to a URL, or a non-YouTube player). */
const YOUTUBE_ID_PACKAGES = new Set(['react-lite-youtube-embed', 'react-youtube', '@justinribeiro/lite-youtube'])
const YOUTUBE_URL = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{1,64})/i

/**
 * Only a small, known set of YouTube embed packages get a working `<iframe>`
 * replacement; every other removed component (Vimeo, Loom, a bespoke
 * in-house player, or any package this doesn't recognize) falls back to the
 * plain comment stub, since guessing at an unfamiliar player's embed URL
 * shape would silently render the wrong video or nothing at all.
 */
function youtubeEmbedVideoId(node: MdxNode, specifier: string): string | undefined {
  const attribute = (attributeName: string): string | undefined => {
    const raw = node.attributes?.find((entry) => entry.name === attributeName)?.value
    return typeof raw === 'string' ? raw : undefined
  }
  if (YOUTUBE_ID_PACKAGES.has(specifier)) {
    const id = attribute('id') ?? attribute('videoId')
    return id && YOUTUBE_VIDEO_ID.test(id) ? id : undefined
  }
  if (specifier === 'react-player') {
    const url = attribute('url')
    const match = url ? YOUTUBE_URL.exec(url) : null
    return match ? match[1] : undefined
  }
  return undefined
}

const parser = unified().use(remarkParse).use(remarkMdx)
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])
const DATA_EXTENSIONS = new Set(['.json', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.woff', '.woff2'])
/**
 * Binary asset types a failed component/module import can still be rescued
 * as: copied verbatim to `public/` and bound to its URL string, rather than
 * losing the reference outright. Includes types `DATA_EXTENSIONS` already
 * lets `copyGraph` copy as a JS-module asset (an image can still fail that
 * path for other reasons — budget, a symlink) and types it never would
 * (`.docx`, `.pdf`: not importable as a JS module, but a real static file).
 */
const RESCUABLE_ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico', '.docx', '.pdf'])

/**
 * Tiny equivalents for the handful of Docusaurus theme/runtime imports a
 * copied component commonly uses, so the component still copies instead of
 * failing outright with "external package requires manual installation" —
 * the same reasoning as `SCAFFOLD_PROVIDED_IMPORTS`, just for names that
 * only exist inside a Docusaurus build. Deliberately small: anything else
 * Docusaurus-specific (`@docusaurus/Translate`, a theme-common hook, ...)
 * still fails copyGraph and is handled by the dead-import-removal fallback
 * (the catch block below) instead of growing this into a Docusaurus shim
 * layer.
 */
const DOCUSAURUS_THEME_SHIMS: Record<string, { filename: string; content: string }> = {
  '@theme/CodeBlock': {
    filename: 'docusaurus-code-block.tsx',
    content: [
      "import type { ReactNode } from 'react'",
      '',
      'export default function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {',
      '  return (',
      '    <pre className={className}>',
      '      <code>{children}</code>',
      '    </pre>',
      '  )',
      '}',
      '',
    ].join('\n'),
  },
  '@docusaurus/BrowserOnly': {
    filename: 'docusaurus-browser-only.tsx',
    content: [
      "'use client'",
      '',
      "import { useEffect, useState, type ReactNode } from 'react'",
      '',
      'export default function BrowserOnly({ children, fallback = null }: { children: () => ReactNode; fallback?: ReactNode }) {',
      '  const [mounted, setMounted] = useState(false)',
      '  useEffect(() => { setMounted(true) }, [])',
      '  return mounted ? <>{children()}</> : <>{fallback}</>',
      '}',
      '',
    ].join('\n'),
  },
}
const SHARED_IMPORTS = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'])
/**
 * Packages the standalone starter already installs as its own runtime
 * dependencies. An MDX page's import of one of these (or of a subpath such
 * as `next/navigation` or `lucide-react/dynamic`), even outside JSX, is not
 * "unavailable": the package is really there, so the page keeps the import
 * and any extracted client module gets a copy of it.
 *
 * `@/…` path aliases are deliberately absent: in a source repository they
 * point at that site's own code, not at Thally's.
 *
 * Drift-guarded by the "SCAFFOLD_PROVIDED_IMPORTS drift guard" test in
 * `packages/migrate/src/__tests__/components.test.ts`.
 */
export const SCAFFOLD_PROVIDED_IMPORTS: ReadonlySet<string> = new Set(['next', 'react-dom', 'clsx', 'lucide-react', 'tailwind-merge'])
function isScaffoldProvidedImport(specifier: string): boolean {
  // Next aliases react-dom/server so renderToString/renderToStaticMarkup throw
  // at render; treat it like an unavailable package rather than keep the page.
  if (/^react-dom\/server(?:[./]|$)/.test(specifier)) return false
  return [...SCAFFOLD_PROVIDED_IMPORTS].some((name) => specifier === name || specifier.startsWith(`${name}/`))
}
/** How a warning names an import that is not available in the migrated project. */
function unavailableImportLabel(specifier: string): string {
  return specifier.startsWith('@/')
    ? `the path alias '${specifier}' (the source site's own code, which the migration does not copy)`
    : `the npm package '${specifier}'`
}
const REACT_GLOBALS = new Set([
  'useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useRef',
  'useReducer', 'useContext', 'useId', 'useTransition', 'useDeferredValue',
  'useImperativeHandle', 'useSyncExternalStore', 'useInsertionEffect',
  'useOptimistic', 'useActionState', 'use', 'createContext', 'forwardRef', 'memo',
])
const MAX_COMPONENT_FILES = 300
const MAX_COMPONENT_BYTES = 20_000_000
const MAX_FILE_BYTES = 2_000_000

/**
 * Where each Thally built-in MDX component actually lives, for building the
 * `MintlifyComponents` shim (below). This must import each leaf module
 * directly rather than the app's `mdx-components.tsx` registry: that
 * registry pulls in `src/mdx/custom-components.tsx`, which re-exports every
 * migrated component — including this very generated file — so importing
 * it here would be circular (`ReferenceError: Cannot access 'X' before
 * initialization` at build time). Kept in sync with
 * `src/components/mdx/mdx-components.tsx`'s own imports by hand; a drift
 * here only means `MintlifyComponents.<Name>` is `undefined` for a name
 * added there, not a crash.
 */
const MINTLIFY_COMPONENT_MODULES: ReadonlyArray<{ module: string; names: ReadonlyArray<string> }> = [
  { module: '@/components/mdx/note', names: ['Note'] },
  { module: '@/components/mdx/agent-prompt', names: ['AgentPrompt'] },
  { module: '@/components/mdx/code-blocks', names: ['CodeGroup'] },
  { module: '@/components/mdx/rich-content', names: ['Columns', 'Frame', 'Hero'] },
  { module: '@/components/mdx/accordion', names: ['Accordion', 'AccordionGroup'] },
  { module: '@/components/mdx/content-cards', names: ['Card', 'CardGroup', 'Tile', 'TileGroup'] },
  { module: '@/components/mdx/content-icon', names: ['Icon'] },
  { module: '@/components/mdx/content-inline', names: ['Badge', 'Tooltip'] },
  { module: '@/components/mdx/color', names: ['Color'] },
  { module: '@/components/mdx/content-metadata', names: ['Update'] },
  { module: '@/components/mdx/panel', names: ['Panel', 'ContentPanel', 'InlinePanel'] },
  { module: '@/components/mdx/examples', names: ['RequestExample', 'ResponseExample', 'InlineRequestExample', 'InlineResponseExample'] },
  { module: '@/components/mdx/prompt', names: ['Prompt', 'PromptAssistant', 'PromptUser', 'Terminal', 'TerminalInput', 'TerminalOutput'] },
  { module: '@/components/mdx/file-tree', names: ['Tree', 'Folder', 'File'] },
  { module: '@/components/mdx/api-fields', names: ['ResponseField', 'ParamField', 'Expandable'] },
  { module: '@/components/mdx/mermaid', names: ['Mermaid'] },
  { module: '@/components/mdx/view', names: ['Embed', 'LegacyView', 'View'] },
  { module: '@/components/mdx/github-card', names: ['GitHub'] },
  { module: '@/components/mdx/visibility', names: ['Agent', 'Human', 'Visibility'] },
  { module: '@/components/mdx/steps', names: ['Steps', 'Step'] },
  { module: '@/components/mdx/content-tabs', names: ['Tabs', 'Tab'] },
]

/** Builtins mapped straight through to their same-named import (aliased, see below). */
const MINTLIFY_DIRECT_COMPONENTS = [
  'AccordionGroup', 'Hero', 'Card', 'CardGroup', 'Columns', 'Frame', 'Accordion', 'Tooltip',
  'Icon', 'Steps', 'Step', 'Tabs', 'Tab', 'Badge', 'Update', 'RequestExample', 'ResponseExample',
  'Panel', 'ContentPanel', 'InlinePanel', 'InlineRequestExample', 'InlineResponseExample',
  'Tile', 'TileGroup', 'Prompt', 'PromptUser', 'PromptAssistant', 'Terminal', 'TerminalInput',
  'TerminalOutput', 'AgentPrompt', 'Color', 'Tree', 'Folder', 'File', 'ResponseField',
  'ParamField', 'Expandable', 'Mermaid', 'View', 'Embed', 'LegacyView', 'GitHub', 'Visibility',
  'Human', 'Agent', 'CodeGroup',
]

/**
 * Mintlify's implicit `MintlifyComponents` global for a copied `.jsx`
 * snippet (`const { Card } = MintlifyComponents;`, no import) — an object
 * of Thally's built-in equivalents. Every import is aliased (`Card as
 * __mintlify_Card`) so none of ~50 bare names land in the snippet's own top
 * level scope and risk colliding with something it already declares; only
 * the single `MintlifyComponents` identifier is introduced unaliased.
 */
function mintlifyComponentsShim(): string {
  const alias = (name: string) => `__mintlify_${name}`
  const imports = MINTLIFY_COMPONENT_MODULES
    .map(({ module, names }) => `import { ${names.map((name) => `${name} as ${alias(name)}`).join(', ')} } from '${module}';`)
    .join('\n')
  const entries = [
    // The callout family all render through Note, whose `type` mdx-components.tsx
    // sets for each name; Callout and Latex mirror that file's own handling.
    `Info: (props) => <${alias('Note')} type="info" {...props} />`,
    `Warning: (props) => <${alias('Note')} type="warning" {...props} />`,
    `Check: (props) => <${alias('Note')} type="check" {...props} />`,
    `Danger: (props) => <${alias('Note')} type="danger" {...props} />`,
    `Error: (props) => <${alias('Note')} type="danger" {...props} />`,
    `Note: (props) => <${alias('Note')} type="note" {...props} />`,
    `Tip: (props) => <${alias('Note')} type="tip" {...props} />`,
    `Callout: (props) => <${alias('Note')} {...props} />`,
    `Latex: ({ children }) => <code>{children}</code>`,
    ...MINTLIFY_DIRECT_COMPONENTS.map((name) => `${name}: ${alias(name)}`),
    `Github: ${alias('GitHub')}`,
  ]
  return `${imports}\nconst MintlifyComponents = {\n  ${entries.join(',\n  ')},\n};`
}

function applyReplacements(source: string, replacements: Array<Replacement>): string {
  return replacements.sort((a, b) => b.start - a.start).reduce(
    (text, edit) => text.slice(0, edit.start) + edit.value + text.slice(edit.end), source,
  )
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function portableSpecifier(path: string): string {
  // Customer tsconfigs do not opt into allowImportingTsExtensions. Next's
  // bundler resolves these extensionless source imports without that flag.
  return path.replace(/\.tsx?$/, '')
}

/**
 * Turbopack's CSS Modules loader requires every selector to contain at
 * least one class or id ("pure"): a copied `.module.css` file that targets
 * `:root`, an element, or an attribute at the top level (a common way to
 * key off a `data-theme` attribute, e.g. Docusaurus' `BrowserWindow`) fails
 * the whole build with `Selector "..." is not pure`, even though the
 * selector compiled and worked fine in its own Docusaurus build. Wrap only
 * the impure branches of each rule's selector list in `:global(...)`
 * (CSS Modules' own escape hatch) using a real selector parser — a
 * character-scanning approach can't tell a selector's structure (nesting,
 * combinators, pseudo-classes) from its text reliably enough to know where
 * a `:global(...)` wrapper legally starts and ends.
 */
function wrapImpureCssModuleSelectors(css: string): string {
  const root = postcss.parse(css)
  root.walkRules((rule) => {
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        let hasClassOrId = false
        selector.walk((node) => {
          if (node.type === 'class' || node.type === 'id') hasClassOrId = true
        })
        if (hasClassOrId) return
        const nodes = selector.nodes.splice(0, selector.nodes.length)
        const container = selectorParser.selector({ value: '' })
        for (const node of nodes) container.append(node)
        const globalPseudo = selectorParser.pseudo({ value: ':global' })
        globalPseudo.append(container)
        selector.append(globalPseudo)
      })
    }).processSync(rule.selector)
  })
  return root.toString()
}

function sourceFile(source: string, filename: string): ts.SourceFile {
  return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    /\.[cm]?ts$/.test(filename) ? ts.ScriptKind.TS : ts.ScriptKind.TSX)
}

function walk(node: MdxNode, visitor: (node: MdxNode) => void): void {
  visitor(node)
  for (const child of node.children ?? []) walk(child, visitor)
}

function implicitReactImports(source: ts.SourceFile): string {
  const bindings = new Set<string>()
  const references = new Set<string>()
  function bind(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) bindings.add(name.text)
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name)
  }
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause
      if (clause.name) bindings.add(clause.name.text)
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) bindings.add(clause.namedBindings.name.text)
        else for (const element of clause.namedBindings.elements) bindings.add(element.name.text)
      }
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bind(declaration.name)
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) bindings.add(statement.name.text)
  }
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
      && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) references.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const hooks = [...REACT_GLOBALS].filter((name) => references.has(name) && !bindings.has(name)).sort()
  // Mintlify's own snippet convention exposes its built-in MDX components as
  // an implicit global too (`const { Card } = MintlifyComponents;`, no
  // import).
  const usesMintlifyComponents = references.has('MintlifyComponents') && !bindings.has('MintlifyComponents')
  return [
    references.has('React') && !bindings.has('React') ? "import * as React from 'react';" : '',
    hooks.length ? `import { ${hooks.join(', ')} } from 'react';` : '',
    usesMintlifyComponents ? mintlifyComponentsShim() : '',
  ].filter(Boolean).join('\n')
}

function imports(statement: ts.ImportDeclaration): Array<Binding> {
  if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) return []
  const clause = statement.importClause
  if (clause.isTypeOnly) return []
  const source = statement.moduleSpecifier.text
  const bindings: Array<Binding> = clause.name ? [{ local: clause.name.text, imported: 'default', source }] : []
  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      if (!element.isTypeOnly) bindings.push({ local: element.name.text, imported: element.propertyName?.text ?? element.name.text, source })
    }
  }
  return bindings
}

/**
 * Every component this migrator actually renders in a client boundary — a
 * copied import (`register`, always prefixed 'use client' by `copyGraph`) or
 * an inline-extracted interactive block (`Inline<n>`) — is renamed to one of
 * these two shapes in the transformed body. No other JSX tag (a Thally
 * built-in, an unregistered/removed component) ever matches.
 */
const EXTRACTED_CLIENT_COMPONENT_TAG = /^(?:Migrated[0-9a-f]+|Inline\d+)$/

/**
 * Thally's own runtime `src/components/mdx/mdx-components.tsx` registry names
 * whose backing module is a 'use client' file under `src/components/mdx/`.
 * Passing a page-authored function as a prop into any of these also throws
 * "Functions cannot be passed directly to Client Components" at render, the
 * same as an extracted component — so they are confirmed exclusion targets
 * too, not just unconfirmed-and-warned.
 *
 * This list is a snapshot, not a live read of the app (a published migrate
 * package cannot import from the app's `src/`). It is drift-guarded by
 * `src/components/mdx/client-registry.test.ts`, which recomputes the same
 * set from `src/components/mdx/*.tsx` and `mdx-components.tsx` and fails CI
 * if this snapshot goes stale.
 *
 * Source file per name (all under `src/components/mdx/`):
 *   Accordion, AccordionGroup      -> accordion.tsx
 *   AgentPrompt                    -> agent-prompt.tsx
 *   ResponseField, ParamField,
 *   Expandable                     -> api-fields.tsx
 *   CodeGroup                      -> code-blocks.tsx
 *   Badge, Tooltip                 -> content-inline.tsx
 *   Tabs, Tab                      -> content-tabs.tsx
 *   RequestExample, ResponseExample,
 *   InlineRequestExample,
 *   InlineResponseExample          -> examples.tsx
 *   Tree, Folder, File             -> file-tree.tsx
 *   Mermaid                        -> mermaid.tsx
 *   Panel, ContentPanel,
 *   InlinePanel                    -> panel.tsx
 *   Prompt, PromptUser,
 *   PromptAssistant, Terminal,
 *   TerminalInput, TerminalOutput  -> prompt.tsx
 *   View, Embed, LegacyView        -> view.tsx
 *   Color, Color.Item              -> color.tsx (server) spreads props into
 *                                      color-item.tsx's 'use client'
 *                                      ColorItemClient — a re-export, not a
 *                                      direct 'use client' file, so it is
 *                                      listed by hand (see the override map
 *                                      in client-registry.test.ts)
 */
export const CLIENT_BUILTIN_COMPONENT_TAGS: ReadonlySet<string> = new Set([
  'Accordion', 'AccordionGroup',
  'AgentPrompt',
  'ResponseField', 'ParamField', 'Expandable',
  'CodeGroup',
  'Badge', 'Tooltip',
  'Tabs', 'Tab',
  'RequestExample', 'ResponseExample', 'InlineRequestExample', 'InlineResponseExample',
  'Tree', 'Folder', 'File',
  'Mermaid',
  'Panel', 'ContentPanel', 'InlinePanel',
  'Prompt', 'PromptUser', 'PromptAssistant', 'Terminal', 'TerminalInput', 'TerminalOutput',
  'View', 'Embed', 'LegacyView',
  'Color', 'Color.Item',
])

function isConfirmedClientBoundaryTag(name: string): boolean {
  return EXTRACTED_CLIENT_COMPONENT_TAG.test(name) || CLIENT_BUILTIN_COMPONENT_TAGS.has(name)
}

/**
 * A JSX attribute's raw expression source (`prop={<this>}`), for the two
 * shapes that end up passing a function value: a bare reference to a
 * page-declared function (`declaredNames`), or a function written inline
 * right there (`() => ...`, `function () { ... }`). Only `mdxJsxAttribute`
 * nodes with an expression value carry a source string here; a string
 * literal attribute (`title="x"`) or a spread (`mdxJsxExpressionAttribute`)
 * never does, so this returns `undefined` for those.
 */
function functionValuedAttribute(node: MdxNode, declaredNames: ReadonlySet<string>): string | undefined {
  const isFunctionValue = (value: string) => declaredNames.has(value.trim()) || isFunctionInitializer(value.trim(), 0)
  for (const attribute of node.attributes ?? []) {
    const raw = attribute.value
    const value = raw && typeof raw === 'object' ? raw.value : undefined
    if (typeof value !== 'string') continue
    if (isFunctionValue(value)) return value
  }
  // Function-as-children (`<Accordion>{() => 'x'}</Accordion>`) is passed as
  // the `children` prop, so it crosses the same boundary. Inline children sit
  // inside a paragraph node; look one level into it.
  const children = (node.children ?? []).flatMap((child) => child.type === 'paragraph' ? child.children ?? [] : [child])
  for (const child of children) {
    if (['mdxFlowExpression', 'mdxTextExpression'].includes(child.type) && child.value && isFunctionValue(child.value)) return child.value
  }
  return undefined
}

/**
 * True when a name in `declaredNames` (typically a page's `export const`/
 * `export function` identifiers) is passed as a bare JSX prop
 * (`prop={Name}`), or a function is written inline as a prop value
 * (`prop={() => ...}`, `prop={function () { ... }}`), into a component
 * confirmed to cross the server/client boundary: one this migrator extracted
 * as a 'use client' module, or a Thally runtime built-in already backed by
 * one (`CLIENT_BUILTIN_COMPONENT_TAGS`). This is the only shape that really
 * throws "Functions cannot be passed directly to Client Components" at
 * render — the same check against an unconfirmed tag would over-fire and
 * drop pages that render just fine.
 *
 * JSX written inside a page's own `export const Name = () => <...>` (bound
 * for client extraction itself) is never visited here: `remark-mdx` parses
 * that whole declaration as a single `mdxjsEsm` text node, not as MDX JSX
 * element nodes, so `walk`'s `.children` traversal never reaches it — the
 * same reason fenced/inline code samples (parsed as `code`/`inlineCode` text
 * nodes) never reach it either.
 */
export function propsTargetExtractedClientComponent(body: string, declaredNames: ReadonlySet<string>): boolean {
  const tree = parser.parse(body) as MdxNode
  let found = false
  walk(tree, (node) => {
    if (found || !node.name || !isConfirmedClientBoundaryTag(node.name)) return
    if (functionValuedAttribute(node, declaredNames) !== undefined) found = true
  })
  return found
}

/**
 * Broader, unconfirmed signal: true when *any* JSX tag on the page (not
 * just a confirmed client boundary) receives a function-valued prop, the
 * same shapes `propsTargetExtractedClientComponent` looks for. Callers use
 * this to decide whether the page is worth a "might throw at render, review
 * manually" warning even when the receiving tag's own client/server status
 * cannot be confirmed.
 */
export function hasAnyFunctionValuedProp(body: string, declaredNames: ReadonlySet<string>): boolean {
  const tree = parser.parse(body) as MdxNode
  let found = false
  walk(tree, (node) => {
    if (found || !node.name) return
    if (functionValuedAttribute(node, declaredNames) !== undefined) found = true
  })
  return found
}

/**
 * True when a page's own inline `export const`/`export function` declaration
 * (kept in place, not extracted into a 'use client' module — see the
 * `mdxjsEsm` note above) references `document` or `window` as an identifier.
 * Next renders an MDX page as a Server Component by default, where neither
 * global exists; callers use this to warn rather than let the page fail at
 * render. Identifiers are found via the TS AST, so a string, comment, or
 * fenced code sample using the same words never counts.
 */
export function declarationsReferenceBrowserGlobal(body: string): boolean {
  const tree = parser.parse(body) as MdxNode
  let found = false
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && (node.text === 'document' || node.text === 'window')) found = true
    ts.forEachChild(node, inspect)
  }
  for (const node of tree.children ?? []) {
    if (found || node.type !== 'mdxjsEsm' || node.value === undefined) continue
    for (const statement of sourceFile(node.value, 'inline.tsx').statements) {
      if (ts.isVariableStatement(statement) || ts.isFunctionDeclaration(statement)) inspect(statement)
    }
  }
  return found
}

/** Create one bounded component graph and registry for a repository migration. */
/**
 * `siteRoot` (a Mintlify/Docusaurus project root, when one was detected —
 * `repositoryDir` otherwise) is what `@site/...`/root-relative (`/...`)
 * specifiers resolve against, matching Docusaurus' own alias semantics; a
 * warning's reported `source` and the generated destination paths stay
 * relative to it too, unchanged from before this parameter split. A plain
 * relative import (`../../components/X`), though, is written relative to
 * the importing *page*, which — in a monorepo where docs/ is a sibling of
 * website/ rather than nested under it (Redux) — can resolve outside
 * `siteRoot` even for a component the repository legitimately owns.
 * `confinementRoot` (always `repositoryDir`) is the actual security
 * boundary for that resolution and for `checkedFile`'s symlink safety walk,
 * so such an import still copies instead of throwing "path escapes its
 * root" for a component this migration should have imported.
 */
export function createComponentMigrator(siteRoot: string, confinementRoot: string, warnings: Array<MigrationWarning>, sourceIdentity: string): {
  transform: (raw: string, currentFile: string) => string
  files: () => Array<RenderedMigrationFile>
} {
  const root = resolve(siteRoot)
  const confined = resolve(confinementRoot)
  // A destination can contain imports from several repositories with identical
  // snippet names. Stable source identity isolates their graphs without tying
  // registry names to a temporary checkout path or changing repeat imports.
  const destinationRoot = `src/mdx/migrated/${hash(sourceIdentity)}`
  const copied = new Map<string, RenderedMigrationFile>()
  const registrations = new Map<string, { path: string; imported: string }>()
  let copiedBytes = 0

  function warn(message: string, source: string): void {
    warnings.push({ code: 'unsupported-config', message, source: relative(root, source).replace(/\\/g, '/') })
  }

  function checkedFile(path: string): string {
    const local = relative(confined, path)
    resolveWithin(confined, local)
    let current = confined
    if (lstatSync(current).isSymbolicLink()) throw new Error('symbolic links are not imported')
    for (const segment of local.split(/[\\/]/)) {
      current = resolveWithin(current, segment)
      if (lstatSync(current).isSymbolicLink()) throw new Error('symbolic links are not imported')
    }
    if (!lstatSync(path).isFile()) throw new Error('dependency is not a regular file')
    return path
  }

  function resolveDependency(specifier: string, importer: string): string {
    if (specifier.includes('\\') || specifier.includes('\0') || /[?#]/.test(specifier)) throw new Error('unsupported component dependency path')
    const candidate = specifier.startsWith('/')
      ? resolveWithin(root, specifier.slice(1))
      : resolveWithin(confined, relative(confined, resolve(dirname(importer), specifier)))
    const candidates = [candidate]
    if (!extname(candidate)) {
      candidates.push(...['.tsx', '.jsx', '.ts', '.js', '.mjs', '.json'].map((extension) => candidate + extension))
      candidates.push(...['index.tsx', 'index.jsx', 'index.ts', 'index.js'].map((name) => resolve(candidate, name)))
    } else if (extname(candidate) === '.js') {
      candidates.push(candidate.slice(0, -3) + '.ts', candidate.slice(0, -3) + '.tsx')
    }
    for (const path of candidates) {
      if (existsSync(path) && lstatSync(path).isFile()) return checkedFile(path)
    }
    throw new Error(`component dependency ${specifier} was not found`)
  }

  function outputPath(path: string): string {
    // Must be `confined`, not `root`: a component reached via a relative
    // import from outside `root` (see `resolveDependency`) is still inside
    // `confined`, and a `../`-containing destination path would risk
    // writing outside `destinationRoot`.
    return `${destinationRoot}/source/${relative(confined, path).replace(/\\/g, '/')}`
  }

  function copyGraph(entry: string): string {
    // Stage the entire graph in memory. A missing leaf must not leave a partly
    // registered component or consume the successful-copy budget.
    const staged = new Map<string, RenderedMigrationFile>()
    let stagedBytes = 0
    /** Stage a small fixed-content shim module (see `DOCUSAURUS_THEME_SHIMS`) once, reused across every component that imports it. */
    function stageShim(filename: string, content: string): string {
      const shimDestination = `${destinationRoot}/shims/${filename}`
      if (!copied.has(shimDestination) && !staged.has(shimDestination)) staged.set(shimDestination, { path: shimDestination, content })
      return shimDestination
    }
    function visit(path: string): void {
      const destination = outputPath(path)
      if (copied.has(destination) || staged.has(destination)) return
      checkedFile(path)
      const size = lstatSync(path).size
      if (size > MAX_FILE_BYTES || copiedBytes + stagedBytes + size > MAX_COMPONENT_BYTES
        || copied.size + staged.size >= MAX_COMPONENT_FILES) throw new Error('component migration budget exceeded')
      const extension = extname(path).toLowerCase()
      if (!CODE_EXTENSIONS.has(extension) && !DATA_EXTENSIONS.has(extension)) throw new Error(`unsupported dependency file type ${extension}`)
      stagedBytes += size
      const content = readFileSync(path)
      staged.set(destination, { path: destination, content })
      if (!CODE_EXTENSIONS.has(extension)) {
        if (extension === '.css' && /@import\b|url\s*\(/i.test(content.toString('utf8'))) throw new Error('CSS resource dependencies require manual migration')
        if (extension === '.css' && path.toLowerCase().endsWith('.module.css')) {
          // A parse failure here (malformed CSS, an SCSS-only construct that
          // isn't valid CSS, ...) is treated the same as any other copy
          // failure: throw, so the dead-import-removal fallback in the
          // caller can neutralize its usage instead of shipping CSS
          // Turbopack would reject anyway.
          let wrapped: string
          try {
            wrapped = wrapImpureCssModuleSelectors(content.toString('utf8'))
          } catch {
            throw new Error('CSS module could not be parsed to check for Turbopack-safe selectors')
          }
          staged.set(destination, { path: destination, content: wrapped })
        }
        return
      }
      const text = content.toString('utf8')
      const syntax = ts.transpileModule(text, { fileName: path, reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
      if (syntax.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('component source contains unsupported JavaScript or TypeScript syntax')
      const ast = sourceFile(text, path)
      if (ast.statements.some((statement) => ts.isExpressionStatement(statement)
        && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use server')) throw new Error('server-only component modules require manual migration')
      const edits: Array<Replacement> = []
      function dependency(literal: ts.StringLiteralLike, importDeclaration?: ts.ImportDeclaration): void {
        const specifier = literal.text
        if (SHARED_IMPORTS.has(specifier) || isScaffoldProvidedImport(specifier)) return
        // `@docusaurus/Link` maps onto `next/link` (already scaffold-provided)
        // rather than a shim module: same default export, only its `to` prop
        // is renamed to `href` wherever the copied file itself uses the tag.
        if (specifier === '@docusaurus/Link') {
          edits.push({ start: literal.getStart(ast), end: literal.end, value: '"next/link"' })
          const localName = importDeclaration?.importClause?.name?.text
          if (localName) {
            function renameToProp(node: ts.Node): void {
              if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'to'
                && ts.isJsxOpeningLikeElement(node.parent.parent)
                && node.parent.parent.tagName.getText(ast) === localName) {
                edits.push({ start: node.name.getStart(ast), end: node.name.end, value: 'href' })
              }
              ts.forEachChild(node, renameToProp)
            }
            renameToProp(ast)
          }
          return
        }
        const shim = DOCUSAURUS_THEME_SHIMS[specifier]
        if (shim) {
          const shimPath = stageShim(shim.filename, shim.content)
          const nextPath = relative(dirname(destination), shimPath).replace(/\\/g, '/')
          edits.push({ start: literal.getStart(ast), end: literal.end, value: JSON.stringify(portableSpecifier(nextPath.startsWith('.') ? nextPath : `./${nextPath}`)) })
          return
        }
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
          throw new Error(specifier.startsWith('@/')
            ? `path alias ${specifier} points to source-site code the migration does not copy`
            : `external package ${specifier} requires manual installation and review`)
        }
        const target = resolveDependency(specifier, path)
        visit(target)
        const nextPath = relative(dirname(destination), outputPath(target)).replace(/\\/g, '/')
        edits.push({ start: literal.getStart(ast), end: literal.end, value: JSON.stringify(portableSpecifier(nextPath.startsWith('.') ? nextPath : `./${nextPath}`)) })
      }
      function inspect(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          dependency(node.moduleSpecifier, ts.isImportDeclaration(node) ? node : undefined)
        }
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          const argument = node.arguments[0]
          if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) throw new Error('computed component imports require manual migration')
          dependency(argument)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(ast)
      // Mark copied code as client-owned even when the source platform inferred
      // its client boundary. Browser hooks must never run in MDX's server scope.
      staged.set(destination, { path: destination, content: `'use client';\n\n${implicitReactImports(ast)}\n${applyReplacements(text, edits)}` })
    }
    visit(entry)
    for (const [path, file] of staged) copied.set(path, file)
    copiedBytes += stagedBytes
    return outputPath(entry)
  }

  /**
   * Copy a binary asset verbatim to a stable `public/` path (bypassing
   * `copyGraph`'s JS-module handling entirely — the asset is bound to its
   * URL string, never imported as a module) and return that URL. Used when
   * an import couldn't be copied as a component but names a real file the
   * page only ever references by URL (`src={Logo}`), never as a JSX tag.
   */
  function copyPublicAsset(path: string): string {
    checkedFile(path)
    const size = lstatSync(path).size
    if (size > MAX_FILE_BYTES || copiedBytes + size > MAX_COMPONENT_BYTES || copied.size >= MAX_COMPONENT_FILES) {
      throw new Error('component migration budget exceeded')
    }
    const publicName = `migrated-${hash(relative(confined, path))}${extname(path).toLowerCase()}`
    const destination = `public/${publicName}`
    if (!copied.has(destination)) {
      copied.set(destination, { path: destination, content: readFileSync(path) })
      copiedBytes += size
    }
    return `/${publicName}`
  }

  /**
   * Docusaurus ships SVGR out of the box, so `import Foo from './foo.svg';
   * <Foo />` renders the SVG as a real component there. The migrated
   * project has no SVGR loader, so importing an `.svg` file the ordinary
   * way (`copyGraph`'s ordinary path, used below) yields whatever the
   * bundler's default asset handling returns for it — a URL string or a
   * `{ src }` object, either way not a valid React element type — and
   * `<Foo />` throws "Element type is invalid" at render. Used only when
   * the import is actually rendered as a JSX tag (an attribute-only usage,
   * `src={Foo}`, needs no wrapper and is left as the plain import): stage a
   * tiny companion module next to the copied SVG that imports it as a URL
   * either way and renders a plain `<img>`, and register that instead of
   * the raw file.
   */
  function wrapSvgAsComponent(svgOutputPath: string): string {
    const wrapperPath = `${svgOutputPath}.component.tsx`
    if (!copied.has(wrapperPath)) {
      const content = [
        "'use client'",
        '',
        `import svgSource from ${JSON.stringify(`./${basename(svgOutputPath)}`)}`,
        '',
        'export default function SvgImage(props: Record<string, unknown>) {',
        '  const src = typeof svgSource === "string" ? svgSource : (svgSource as { src: string }).src',
        '  // eslint-disable-next-line @next/next/no-img-element -- no SVGR loader is configured; this renders the raw file.',
        '  return <img src={src} alt="" {...props} />',
        '}',
        '',
      ].join('\n')
      copied.set(wrapperPath, { path: wrapperPath, content })
    }
    return wrapperPath
  }

  function register(path: string, imported: string): string {
    const name = `Migrated${hash(`${path}:${imported}`)}`
    registrations.set(name, { path, imported })
    return name
  }

  function transform(raw: string, currentFile: string): string {
    const parsedFrontmatter = parseFrontmatter(raw).content
    const frontmatter = raw.slice(0, raw.length - parsedFrontmatter.length)
    // remark-mdx does not parse a raw HTML comment (`<!-- ... -->`) at all —
    // a real source page commonly has one (Docusaurus' own
    // `<!-- prettier-ignore -->` ahead of a snippet import) and it
    // otherwise throws here before this pass ever runs, leaving whatever
    // import that comment sits near completely untouched. `normalizeMdx`
    // converts the same syntax later in the pipeline anyway, so doing it
    // here too (on this function's own working copy) is never wasted work.
    const content = normalizeHtmlComments(parsedFrontmatter)
    let tree: MdxNode
    try {
      tree = parser.parse(content) as MdxNode
    } catch {
      warn('Custom component analysis could not parse this MDX; its source was preserved for manual migration.', currentFile)
      return raw
    }
    const aliases = new Map<string, string>()
    const unsupportedImports = new Map<string, string>()
    const edits: Array<Replacement> = []
    const declarations: Array<{ start: number; end: number; source: string }> = []
    const moduleImports: Array<string> = []
    const realPageImports: Array<string> = []
    const sharedImportEdits: Array<Replacement> = []
    let hasUnsupportedImports = false
    function hasExpressionReference(names: Set<string>, options: {
      excludedNodes?: Array<MdxNode>
      includeDeclarations?: boolean
      includeDirectTags?: boolean
    } = {}): boolean {
      let found = false
      function inspect(node: ts.Node): void {
        if (ts.isIdentifier(node) && names.has(node.text)) found = true
        ts.forEachChild(node, inspect)
      }
      walk(tree, (node) => {
        if (options.excludedNodes?.some((excluded) => node.position?.start.offset !== undefined
          && node.position.end.offset !== undefined
          && node.position.start.offset >= excluded.position!.start.offset!
          && node.position.end.offset <= excluded.position!.end.offset!)) return
        if (node.name && [...names].some((name) => node.name!.startsWith(`${name}.`)
          || (options.includeDirectTags && node.name === name))) found = true
        if (options.includeDeclarations !== false && node.type === 'mdxjsEsm' && node.value) {
          for (const statement of sourceFile(node.value, 'expression.tsx').statements) {
            if (!ts.isImportDeclaration(statement)) inspect(statement)
          }
        }
        const expressions = [
          ...(['mdxFlowExpression', 'mdxTextExpression'].includes(node.type) ? [node.value ?? ''] : []),
          ...(node.attributes ?? []).flatMap((attribute) => {
            if (attribute.type === 'mdxJsxExpressionAttribute' && typeof attribute.value === 'string') return [attribute.value]
            return attribute.value && typeof attribute.value === 'object' ? [attribute.value.value ?? ''] : []
          }),
        ]
        for (const expression of expressions) inspect(sourceFile(expression, 'expression.tsx'))
      })
      return found
    }
    /** True when `name` is ever a JSX tag's own root name (`<name ...>`), regardless of any other usage — narrower than `hasExpressionReference`'s combined signal, needed where a string binding (an asset's URL) is fine for any *other* usage but not this one. */
    function usedAsJsxTagName(name: string): boolean {
      let found = false
      walk(tree, (node) => { if (node.name === name) found = true })
      return found
    }
    // Docusaurus allows a real `import`/`export` ESM block anywhere in the
    // body, not just at the top of the file — a documentation page
    // demonstrating a live code example commonly nests one inside a JSX
    // wrapper (`<BrowserWindow>\nimport Foo from './foo.svg'\n\n<Foo
    // /></BrowserWindow>`, straight from Docusaurus' own docs). remark-mdx
    // still parses each as its own `mdxjsEsm` node, just nested under that
    // wrapper's `children` instead of `tree.children` directly, so this
    // must walk the whole tree to find every one of them; a scan of only
    // `tree.children` silently skips a nested import, leaving the page
    // referencing a path the migrated project never has ("Module not
    // found") without any warning at all.
    const esmNodes: Array<MdxNode> = []
    walk(tree, (node) => { if (node.type === 'mdxjsEsm') esmNodes.push(node) })
    for (const node of esmNodes) {
      if (node.value === undefined || node.position?.start.offset === undefined) continue
      const ast = sourceFile(node.value, 'inline.tsx')
      for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement)) {
          let unsupportedDependency = ts.isExportDeclaration(statement) && !!statement.moduleSpecifier
          function inspect(node: ts.Node): void {
            if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
              || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) unsupportedDependency = true
            ts.forEachChild(node, inspect)
          }
          inspect(statement)
          if (unsupportedDependency) {
            hasUnsupportedImports = true
            warn('Inline MDX module dependencies require manual extraction; source was preserved.', currentFile)
          }
          declarations.push({
            start: node.position.start.offset + statement.getStart(ast),
            end: node.position.start.offset + statement.end,
            source: statement.getText(ast),
          })
          continue
        }
        const bindings = imports(statement)
        const rawSpecifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ''
        // `@site/...` is Docusaurus' and Mintlify's shared alias for the
        // project root; treat it exactly like the root-relative `/...` form
        // `resolveDependency` already understands, so a locally-owned
        // component copies the same way a relative import would.
        const specifier = rawSpecifier.startsWith('@site/') ? `/${rawSpecifier.slice('@site/'.length)}` : rawSpecifier
        if (isScaffoldProvidedImport(specifier)) {
          // Installed in the migrated project: keep it on the page (content
          // outside an extracted block may use it) and copy it into any
          // extracted client module, whose moved declarations may use it too.
          moduleImports.push(statement.getText(ast))
          continue
        }
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
          if (SHARED_IMPORTS.has(specifier)) {
            moduleImports.push(statement.getText(ast))
            sharedImportEdits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
          } else if (specifier.startsWith('@theme/') || specifier.startsWith('@docusaurus/')) {
            // Docusaurus' own theme/runtime components (Tabs, TabItem, Link,
            // useBaseUrl, ...) are converted to Thally's equivalents by
            // normalizeMdx right after this pass; just drop the now-redundant
            // import and leave JSX usage untouched for that pass to rewrite.
            edits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
          } else if (hasExpressionReference(new Set(bindings.map((binding) => binding.local)))) {
            // Only JSX usage (`<Widget />`) is rewritten below; a reference
            // in `{pkg.fn()}`, a prop, or an inline `export const` cannot be
            // rewritten the same way. Dropping the import would leave an
            // undefined identifier; keeping it imports a package that is not
            // installed in the migrated project, which fails `next build`
            // for the *whole* site with "Module not found" — not just this
            // page. Excluding the page is the only option that keeps the
            // rest of the site building; `pruneMissingNavigationPages` (see
            // repository.ts) then drops it from navigation too.
            warnings.push({
              code: 'skipped-file',
              message: `This page was excluded because it uses '${bindings.map((binding) => binding.local).join(', ')}' from ${unavailableImportLabel(rawSpecifier)} outside JSX (in an expression, prop, or inline declaration), and that import isn't available in the migrated project. Make '${rawSpecifier}' available and add the import back manually, or rewrite the page to avoid it.`,
              source: relative(root, currentFile).replace(/\\/g, '/'),
            })
            hasUnsupportedImports = true
          } else {
            // An npm package Thally's runtime does not ship is not installed
            // in the migrated project; leaving the import in place breaks
            // `next build` with "Module not found". Drop the import and
            // replace its JSX usage with a safe fallback instead (see the
            // `unsupportedImports` walk below) rather than shipping a page
            // that cannot compile.
            warn(`MDX import of ${unavailableImportLabel(rawSpecifier)} is not available in the migrated project; the import was removed and its usage replaced.`, currentFile)
            edits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
            for (const binding of bindings) unsupportedImports.set(binding.local, rawSpecifier)
          }
          continue
        }
        if (/\.mdx?$/.test(specifier)) continue
        // A binary asset (`docusaurusLogo.svg`, a `.docx` handout, ...) is
        // never really "a component" — it's fine bound to any identifier
        // shape and referenced from an expression (`src={docusaurusLogo}`),
        // unlike the component-alias mechanism below, which can only
        // rewrite a literal JSX tag name, not an arbitrary expression
        // reference. Handle it before the component-shaped checks reject it
        // for the wrong reason (a lowercase local name, expression usage)
        // and leave a dead import behind. Only bail out of this path (to
        // the ordinary handling below, which removes the import either way)
        // when the same local name is *also* used as a JSX tag — a string
        // URL bound there would throw just as hard as the missing import.
        if (bindings.length && RESCUABLE_ASSET_EXTENSIONS.has(extname(specifier).toLowerCase())
          && !bindings.some((binding) => usedAsJsxTagName(binding.local))) {
          try {
            const href = copyPublicAsset(resolveDependency(specifier, currentFile))
            edits.push({
              start: node.position.start.offset + statement.getStart(ast),
              end: node.position.start.offset + statement.end,
              value: bindings.map((binding) => `const ${binding.local} = ${JSON.stringify(href)};`).join('\n'),
            })
            warn(`Asset import ${JSON.stringify(rawSpecifier)} was copied to ${href} and bound to that URL instead of importing it as a component.`, currentFile)
            continue
          } catch {
            // Not actually resolvable/copyable (missing file, budget) —
            // fall through to the ordinary handling below.
          }
        }
        if (!bindings.length || (statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings))) {
          warn('Namespace or side-effect MDX imports require manual registration; the import was preserved.', currentFile)
          hasUnsupportedImports = true
          continue
        }
        if (bindings.some((binding) => !/^[A-Z]/.test(binding.local))) {
          warn('MDX imports containing non-component values require manual migration; the import was preserved.', currentFile)
          hasUnsupportedImports = true
          continue
        }
        // Unlike the unavailable-npm-package case above, a local/relative
        // import is fully owned by the migration: `copyGraph` below moves
        // the whole file (and its own local dependency graph) into the
        // project, and the statement it emits keeps every binding's original
        // local name (`as ${binding.local}`) — only the module specifier
        // changes. Nothing in the page body needs renaming, so it makes no
        // difference whether a binding is used as a bare JSX tag or only
        // referenced elsewhere (an enum member on a sibling prop, a member
        // tag, a wrapping declaration, ...): the copy is attempted either
        // way, and the page is excluded only if that copy genuinely fails
        // (an unsupported dependency inside the local graph — see the catch
        // below), not merely because of how the binding is used.
        try {
          const path = copyGraph(resolveDependency(specifier, currentFile))
          const isSvgUsedAsTag = extname(path).toLowerCase() === '.svg' && bindings.some((binding) => usedAsJsxTagName(binding.local))
          for (const binding of bindings) {
            const registerPath = isSvgUsedAsTag ? wrapSvgAsComponent(path) : path
            const registerImported = isSvgUsedAsTag ? 'default' : binding.imported
            // MDX's own component-injection pass (recma-jsx-rewrite) only
            // rewrites a JSX tag it finds as a genuine, direct mdast JSX
            // node (`<Foo>` as its own markdown/JSX child) to pull from the
            // shared `_components` scope (the customComponents registry
            // below) — the alias-rename walk further down can likewise only
            // text-replace that same direct form. Any other shape —
            // `Capability.ToolUse` in a sibling prop's object literal,
            // `<Widget />` nested inside a `{...}` expression or an
            // `export const` declaration, a member tag `<Widget.Item />`,
            // a plain value passed as a prop (`as={Widget}`) — is invisible
            // to both, and registering it under an aliased key would leave
            // the literal reference an unresolved free variable
            // (`ReferenceError` at render; reproduced against a real
            // Cohere build for both an enum-in-a-prop and a component
            // nested in a `.map()` callback). Give any such binding a real
            // import instead, keeping its original local name and using the
            // project's `@/` alias so the specifier resolves regardless of
            // where the generated runtime module that embeds this page
            // ends up on disk.
            if (!isSvgUsedAsTag && hasExpressionReference(new Set([binding.local]))) {
              const aliasSpecifier = portableSpecifier(`@/${registerPath.replace(/^src\//, '').replace(/\\/g, '/')}`)
              realPageImports.push(`import { ${registerImported} as ${binding.local} } from ${JSON.stringify(aliasSpecifier)};`)
              continue
            }
            const name = register(registerPath, registerImported)
            aliases.set(binding.local, name)
            moduleImports.push(`import { ${registerImported} as ${binding.local} } from ${JSON.stringify(portableSpecifier(`./${relative(destinationRoot, registerPath).replace(/\\/g, '/')}`))};`)
          }
          edits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
        } catch (error) {
          hasUnsupportedImports = true
          const importStart = node.position.start.offset + statement.getStart(ast)
          const importEnd = node.position.start.offset + statement.end
          // The component itself couldn't be copied (unsupported syntax, a
          // budget limit, a missing file, ...). Leaving the import in place
          // referenced a module that will never exist in the migrated
          // project, which fails `next build` for the *whole* site with
          // "Module not found" — not just this page (the same reasoning as
          // the unsupported-npm-import case above). Remove it. Its bindings
          // are known to be used only as JSX tags here (any expression/prop
          // usage already excluded this import from reaching this try, via
          // the `hasExpressionReference` check above), so a plain-page
          // rescan (`replaceUnknownComponents`, mdx.ts, run by repository.ts
          // after this transform) will find each now-undeclared tag and
          // neutralize it (a paired tag keeps its children in a `<div>`; a
          // self-closing one is removed) rather than leave a dangling
          // reference.
          let rescuedAssetHref: string | undefined
          if (RESCUABLE_ASSET_EXTENSIONS.has(extname(specifier).toLowerCase())) {
            // Only worth rescuing as a URL string when nothing ever renders
            // it as a JSX tag (`<Logo />`) — a string bound to a component
            // reference would throw just as hard as the missing import did.
            const usedAsJsxTag = bindings.some((binding) => hasExpressionReference(new Set([binding.local]), { includeDirectTags: true }))
            if (!usedAsJsxTag) {
              try {
                rescuedAssetHref = copyPublicAsset(resolveDependency(specifier, currentFile))
              } catch {
                rescuedAssetHref = undefined
              }
            }
          }
          if (rescuedAssetHref !== undefined) {
            edits.push({
              start: importStart,
              end: importEnd,
              value: bindings.map((binding) => `const ${binding.local} = ${JSON.stringify(rescuedAssetHref)};`).join('\n'),
            })
            warn(`Asset import ${JSON.stringify(rawSpecifier)} could not be copied as a component; it was copied to ${rescuedAssetHref} and bound to that URL instead.`, currentFile)
          } else {
            edits.push({ start: importStart, end: importEnd, value: '' })
            warn(`Component import ${JSON.stringify(rawSpecifier)} could not be copied and was removed: ${error instanceof Error ? error.message : 'unsupported dependency'}. Its usage on this page was neutralized.`, currentFile)
          }
        }
      }
    }

    // Docusaurus' own docs teach `require('./relative/asset.ext').default`
    // as the idiom for linking a JSX attribute (`href={...}`) straight to a
    // static asset — real, working MDX on the source site, but a dangling
    // `require()` of a path the migrated project never has once copied
    // verbatim ("Module not found" at build time). Only a JSX *attribute*
    // expression is handled here (`mdxFlowExpression`/`mdxTextExpression`
    // bodies never hit this shape in practice and the ESM-import loop above
    // already covers a bare top-level `require()`); each attribute's own
    // `position` bounds the replacement to just that attribute's text, so
    // this can never match the identical-looking call inside a *fenced code
    // example* documenting the very same idiom (a real risk here, since
    // Docusaurus' own assets.mdx page shows both side by side).
    walk(tree, (node) => {
      for (const attribute of node.attributes ?? []) {
        if (attribute.type !== 'mdxJsxAttribute' || !attribute.value || typeof attribute.value !== 'object') continue
        const start = attribute.position?.start.offset
        const end = attribute.position?.end.offset
        if (start === undefined || end === undefined) continue
        const attributeText = content.slice(start, end)
        const match = attributeText.match(/require\(\s*(['"])((?:\.\.?\/|\/|@site\/)[^'"]+?\.(?:svg|png|jpe?g|webp|gif|avif|ico|docx|pdf))\1\s*\)(?:\.default|\.src)?/)
        if (!match || match.index === undefined) continue
        try {
          const specifier = match[2]
          const normalized = specifier.startsWith('@site/') ? `/${specifier.slice('@site/'.length)}` : specifier
          const resolvedPath = normalized.startsWith('/') ? resolveWithin(root, normalized.slice(1)) : resolveDependency(normalized, currentFile)
          const href = copyPublicAsset(resolvedPath)
          const replaced = attributeText.slice(0, match.index) + JSON.stringify(href) + attributeText.slice(match.index + match[0].length)
          edits.push({ start, end, value: replaced })
        } catch {
          // Not actually resolvable/copyable — leave the attribute as-is;
          // the MDX-compile/build check reports the real problem.
        }
      }
    })

    // A page-local declaration (not imported) that uses a hook or an event
    // handler must move to the client module along with its invocation: left
    // inline, it compiles into the page's own server-rendered module, where
    // `useState` and friends are never in scope (see `implicitReactImports`,
    // only applied to extracted client files).
    const statefulDeclarationNames = new Set(
      declarations
        .filter(({ source }) => /\bon[A-Z]\w*\s*=|\buse[A-Z]\w*\s*\(/.test(source))
        .map(({ source }) => source.match(/^export const (\w+)/)?.[1])
        .filter((name): name is string => !!name),
    )

    // Extract whole HTML JSX roots with event handlers. Markdown and global
    // built-ins remain server-rendered; React functions stay inside the client
    // module, so no function is serialized across a server/client boundary.
    const extracted: Array<{ node: MdxNode; name: string; jsx: string }> = []
    for (const candidate of tree.children ?? []) {
      const node = candidate.type === 'paragraph' && candidate.children?.length === 1 ? candidate.children[0] : candidate
      if (!['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type) || node.position?.start.offset === undefined || node.position.end.offset === undefined) continue
      let interactive = statefulDeclarationNames.has(node.name ?? '')
      let supported = true
      walk(node, (child) => {
        if (child.attributes?.some((attribute) => /^on[A-Z]/.test(attribute.name ?? ''))) interactive = true
        if (child.name && /^[A-Z]/.test(child.name) && !aliases.has(child.name) && !statefulDeclarationNames.has(child.name)) supported = false
        if (!['mdxJsxFlowElement', 'mdxJsxTextElement', 'mdxFlowExpression', 'mdxTextExpression', 'text', 'paragraph'].includes(child.type)) supported = false
      })
      if (!interactive) continue
      if (!supported || hasUnsupportedImports) {
        warn('Interactive MDX containing Markdown or unregistered components requires manual extraction; source was preserved.', currentFile)
        continue
      }
      const jsx = content.slice(node.position.start.offset, node.position.end.offset)
      // The JSX compiler is the final syntax gate: Markdown embedded in JSX
      // must not accidentally become JavaScript in the generated module.
      const result = ts.transpileModule(`export default function Inline() { return (${jsx}); }`, {
        fileName: 'inline.jsx', compilerOptions: { jsx: ts.JsxEmit.Preserve }, reportDiagnostics: true,
      })
      if (result.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
        warn('Interactive MDX could not be safely extracted as JSX; source was preserved.', currentFile)
        continue
      }
      extracted.push({ node, name: `Inline${extracted.length}`, jsx })
    }
    if (extracted.length && declarations.length) {
      const declared = new Set<string>()
      function bind(name: ts.BindingName): void {
        if (ts.isIdentifier(name)) declared.add(name.text)
        else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name)
      }
      for (const declaration of declarations) {
        for (const statement of sourceFile(declaration.source, 'declaration.tsx').statements) {
          if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) declared.add(statement.name.text)
          if (ts.isVariableStatement(statement)) for (const variable of statement.declarationList.declarations) bind(variable.name)
        }
      }
      const hasSharedDeclarations = hasExpressionReference(declared, {
        excludedNodes: extracted.map((entry) => entry.node),
        includeDeclarations: false,
        includeDirectTags: true,
      })
      if (hasSharedDeclarations) {
        warn('Interactive MDX shares declarations with remaining page content; source was preserved for manual extraction.', currentFile)
        extracted.length = 0
      }
    }
    if (extracted.length && (copied.size >= MAX_COMPONENT_FILES
      || Buffer.byteLength(content) > MAX_FILE_BYTES
      || copiedBytes + Buffer.byteLength(content) > MAX_COMPONENT_BYTES)) {
      warn('Interactive MDX exceeded the component migration budget; source was preserved.', currentFile)
      extracted.length = 0
    }
    if (extracted.length) {
      const path = `${destinationRoot}/inline-${hash(relative(root, currentFile))}.jsx`
      let declarationSource = [...new Set(declarations.map((entry) => entry.source))].join('\n\n')
      // Mintlify exposes this DOM id as its documented search trigger. Thally
      // opens search through the same keyboard event handled by CommandSearch.
      declarationSource = declarationSource.replace(/document\.getElementById\(\s*(['"])search-bar-entry\1\s*\)\.click\(\s*\)/g,
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`)
      const inlineSource = [
        ...moduleImports, '', declarationSource, '',
        ...extracted.map(({ name, jsx }) => `export function ${name}() {\n  return (${jsx});\n}`), '',
      ].join('\n')
      // A single leading directive: `inlineSource` no longer carries its own,
      // or Next rejects the file ("use client" must be the first statement).
      copied.set(path, { path, content: `'use client';\n${implicitReactImports(sourceFile(inlineSource, 'inline.jsx'))}\n${inlineSource}` })
      copiedBytes += Buffer.byteLength(inlineSource)
      for (const { node, name } of extracted) {
        edits.push({ start: node.position!.start.offset!, end: node.position!.end.offset!, value: `<${register(path, name)} />` })
      }
      edits.push(...declarations.map(({ start, end }) => ({ start, end, value: '' })), ...sharedImportEdits)
    }
    walk(tree, (node) => {
      const replacement = node.name ? aliases.get(node.name) : undefined
      if (!replacement || node.position?.start.offset === undefined || node.position.end.offset === undefined) return
      const start = node.position.start.offset
      const end = node.position.end.offset
      if (extracted.some((item) => start >= item.node.position!.start.offset! && end <= item.node.position!.end.offset!)) return
      const text = content.slice(start, end)
      const opening = text.indexOf(`<${node.name}`)
      if (opening >= 0) edits.push({ start: start + opening + 1, end: start + opening + 1 + node.name!.length, value: replacement })
      const closing = text.lastIndexOf(`</${node.name}`)
      if (closing >= 0) edits.push({ start: start + closing + 2, end: start + closing + 2 + node.name!.length, value: replacement })
    })
    // Every usage of a removed npm-package import is replaced whole (tag,
    // props, and children) rather than just its name: nothing in the
    // migrated project can render it. A video-embed-shaped usage (an `id`
    // prop, a name suggesting an embedded player) gets a trivial working
    // `<iframe>`; anything else becomes a visible, greppable MDX comment.
    walk(tree, (node) => {
      const specifier = node.name ? unsupportedImports.get(node.name) : undefined
      if (!specifier || node.position?.start.offset === undefined || node.position.end.offset === undefined) return
      const start = node.position.start.offset
      const end = node.position.end.offset
      const videoId = youtubeEmbedVideoId(node, specifier)
      const value = videoId
        ? `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="Embedded video" allowFullScreen />`
        : `{/* Removed <${node.name}>: unsupported import '${specifier}' */}`
      edits.push({ start, end, value })
    })
    const rendered = applyReplacements(content, edits)
    // Inserted after all offset-based edits (it has no position in the
    // original source) so it lands once, at the very top of the body.
    const realImportsBlock = realPageImports.length ? `${[...new Set(realPageImports)].join('\n')}\n\n` : ''
    return frontmatter + realImportsBlock + rendered
  }

  function files(): Array<RenderedMigrationFile> {
    // A rescued asset (`copyPublicAsset`) lands in `copied` without ever
    // registering a component; it still needs emitting even when nothing
    // was registered.
    if (!copied.size) return []
    if (!registrations.size) return [...copied.values()]
    const entries = [...registrations.entries()].sort(([a], [b]) => a.localeCompare(b))
    return [...copied.values(), {
      path: 'src/mdx/custom-components.tsx',
      content: [
        '/** Repository components preserved by migration; this registry is customer-owned. */',
        "import type { MDXComponents } from 'mdx/types'", ...entries.map(([name, binding]) => {
          const path = portableSpecifier(`./${relative('src/mdx', binding.path).replace(/\\/g, '/')}`)
          return `import { ${binding.imported} as ${name} } from ${JSON.stringify(path)}`
        }), '',
        // Not every registered local binding is JSX-taggable — a companion
        // value from the same import (an enum used only as `Foo.Bar` inside
        // another component's prop, e.g.) is registered too, so the whole
        // MDX scope resolves it. `MDXComponents`' index signature expects a
        // component at every key, which such a value structurally is not;
        // cast rather than exclude it, since excluding it would leave a
        // dangling reference in the page that DOES need it.
        'export const customComponents = {',
        ...entries.map(([name]) => `  ${name},`), '} as unknown as MDXComponents', '',
      ].join('\n'),
    }]
  }
  return { transform, files }
}

/** Preserve an authored component registry while adding an isolated import map. */
export function mergeComponentRegistry(existing: string, incoming: string): Array<RenderedMigrationFile> {
  const fingerprint = hash(incoming)
  const name = `MigratedRegistry${fingerprint}`
  const registryPath = `./migrated-components-${fingerprint}`
  const source = sourceFile(existing, 'custom-components.tsx')
  const alreadyImported = source.statements.some((statement) => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === registryPath)
  let initializer: ts.Expression | undefined
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'customComponents') initializer = declaration.initializer
    }
  }
  while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) initializer = initializer.expression
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error('Cannot safely merge src/mdx/custom-components.tsx: export customComponents as an object literal before importing components. The existing registry was preserved.')
  }
  const content = alreadyImported ? existing : applyReplacements(existing, [
    { start: source.statements.filter((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)).at(-1)?.end ?? 0,
      end: source.statements.filter((statement) => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)).at(-1)?.end ?? 0,
      value: `\nimport { customComponents as ${name} } from ${JSON.stringify(registryPath)}\n` },
    { start: initializer.getStart(source) + 1, end: initializer.getStart(source) + 1, value: `\n  ...${name},` },
  ])
  return [
    { path: `src/mdx/migrated-components-${fingerprint}.tsx`, content: incoming },
    { path: 'src/mdx/custom-components.tsx', content },
  ]
}
