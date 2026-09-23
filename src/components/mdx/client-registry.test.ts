/**
 * `@thallylabs/migrate` cannot import this app's `src/` at runtime (it ships
 * standalone), so `packages/migrate/src/components.ts` keeps a hardcoded
 * snapshot of which `mdx-components.tsx` registry names are backed by a
 * 'use client' module here (`CLIENT_BUILTIN_COMPONENT_TAGS`). This test
 * recomputes the same set straight from the registry and this directory's
 * files, so a renderer change that adds/removes/re-homes a client component
 * fails CI here instead of silently going stale in the migrator.
 *
 * The registry and each candidate file are parsed with the TypeScript
 * compiler API rather than line regexes, so a multi-line arrow wrapper
 * (`(props) => (\n  <Accordion ... />\n)`), an aliased import, or a `'use
 * client'` directive that isn't the very first line of the file are all
 * resolved correctly instead of silently falling through a regex's blind
 * spots.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { CLIENT_BUILTIN_COMPONENT_TAGS } from '../../../packages/migrate/src/components.js'

const mdxDir = dirname(fileURLToPath(import.meta.url))
const registrySource = readFileSync(join(mdxDir, 'mdx-components.tsx'), 'utf8')

function parse(source: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** local identifier (as bound in this file) -> the module specifier it was imported from. */
function importedBindings(sourceFile: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const mod = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) bindings.set(clause.name.text, mod)
    const named = clause.namedBindings
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) bindings.set(element.name.text, mod)
    }
  }
  return bindings
}

/** The root identifier a JSX tag name expression is rooted at (`Color.Item` -> `Color`). */
function rootTagIdentifier(tagName: ts.JsxTagNameExpression): string | undefined {
  if (ts.isIdentifier(tagName)) return tagName.text
  if (ts.isPropertyAccessExpression(tagName)) return rootTagIdentifier(tagName.expression as ts.JsxTagNameExpression)
  return undefined
}

/** Unwraps parenthesized expressions and `as`/`satisfies` assertions down to the real expression. */
function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (true) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) { current = current.expression; continue }
    return current
  }
}

/** The local identifier a registry entry's value actually renders: a JSX tag's root name, or a bare identifier reference. */
function renderedLocalIdentifier(initializer: ts.Expression): string | undefined {
  const value = unwrap(initializer)
  if (ts.isIdentifier(value)) return value.text
  if (!ts.isArrowFunction(value) && !ts.isFunctionExpression(value)) return undefined
  const body = value.body
  // The first component (capitalized) tag rendered, looking through
  // intrinsic wrappers (`<div>`, `<span>`) and fragments (`<>...</>`).
  const jsxRoot = (node: ts.Node): ts.JsxTagNameExpression | undefined => {
    const inner = ts.isExpression(node) ? unwrap(node) : node
    let tagName: ts.JsxTagNameExpression | undefined
    let children: ts.NodeArray<ts.JsxChild> | undefined
    if (ts.isJsxElement(inner)) { tagName = inner.openingElement.tagName; children = inner.children }
    else if (ts.isJsxSelfClosingElement(inner)) tagName = inner.tagName
    else if (ts.isJsxFragment(inner)) children = inner.children
    else return undefined
    if (tagName && !(ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text))) return tagName
    for (const child of children ?? []) {
      const found = ts.isJsxExpression(child) ? (child.expression ? jsxRoot(child.expression) : undefined) : jsxRoot(child)
      if (found) return found
    }
    return undefined
  }
  if (ts.isBlock(body)) {
    let tagName: ts.JsxTagNameExpression | undefined
    for (const statement of body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        const found = jsxRoot(statement.expression)
        if (found) tagName = found
      }
    }
    return tagName ? rootTagIdentifier(tagName) : undefined
  }
  const tagName = jsxRoot(body)
  return tagName ? rootTagIdentifier(tagName) : undefined
}

/** Registry object key -> local identifier its JSX/value actually renders (e.g. Accordion -> Accordion, 'Color.Item' -> Color). */
function registryEntries(sourceFile: ts.SourceFile): Map<string, string> {
  const entries = new Map<string, string>()
  let objectLiteral: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'components' && node.initializer) {
      const initializer = unwrap(node.initializer)
      if (ts.isObjectLiteralExpression(initializer)) objectLiteral = initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!objectLiteral) return entries
  for (const property of objectLiteral.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      entries.set(property.name.text, property.name.text)
      continue
    }
    if (!ts.isPropertyAssignment(property)) continue
    const key = ts.isStringLiteral(property.name) || ts.isIdentifier(property.name)
      ? property.name.text
      : undefined
    if (!key) continue
    const local = renderedLocalIdentifier(property.initializer)
    if (local) entries.set(key, local)
  }
  return entries
}

/** True when the file's first statement is a `'use client'` directive prologue entry, per the TS AST (not just line 1 of the text). */
function isClientDirectiveFile(fileName: string): boolean {
  const content = readFileSync(join(mdxDir, fileName), 'utf8')
  const sourceFile = parse(content, fileName)
  const first = sourceFile.statements[0]
  return !!first
    && ts.isExpressionStatement(first)
    && ts.isStringLiteral(first.expression)
    && first.expression.text === 'use client'
}

/**
 * Registry entries where a server wrapper renders a client component one
 * level down instead of being a 'use client' file itself (`color.tsx`, a
 * server file, spreads props into `color-item.tsx`'s 'use client'
 * `ColorItemClient`). The check below only follows one hop (registry entry ->
 * its own imported module), so these are listed by hand; the drift test after
 * it verifies that each listed server file still imports its client file and
 * that the client file still starts with 'use client'.
 */
const KNOWN_INDIRECT_CLIENT_TAGS: Record<string, { server: string; client: string }> = {
  Color: { server: 'color.tsx', client: 'color-item.tsx' },
  'Color.Item': { server: 'color.tsx', client: 'color-item.tsx' },
}

it('every hand-listed indirect client tag still renders through a use-client file', () => {
  for (const [tag, { server, client }] of Object.entries(KNOWN_INDIRECT_CLIENT_TAGS)) {
    expect(isClientDirectiveFile(client), `${tag}: ${client} must start with 'use client'`).toBe(true)
    expect(isClientDirectiveFile(server), `${tag}: ${server} is itself 'use client'; list it normally`).toBe(false)
    const serverImports = new Set(importedBindings(parse(readFileSync(join(mdxDir, server), 'utf8'), server)).values())
    const clientModule = `@/components/mdx/${client.replace(/\.tsx$/, '')}`
    expect(serverImports.has(clientModule) || serverImports.has(`./${client.replace(/\.tsx$/, '')}`),
      `${tag}: ${server} no longer imports ${client}`).toBe(true)
  }
})

it('every mdx-components.tsx registry name backed by a use-client file in this directory is captured', () => {
  const sourceFile = parse(registrySource, 'mdx-components.tsx')
  const bindings = importedBindings(sourceFile)
  const entries = registryEntries(sourceFile)
  const clientFiles = new Set(readdirSync(mdxDir).filter((f) => f.endsWith('.tsx') && isClientDirectiveFile(f)))

  const expectedClientTags = new Set<string>(Object.keys(KNOWN_INDIRECT_CLIENT_TAGS))
  for (const [key, local] of entries) {
    const mod = bindings.get(local)
    if (!mod?.startsWith('@/components/mdx/')) continue
    const fileName = `${mod.slice('@/components/mdx/'.length)}.tsx`
    if (clientFiles.has(fileName) && /^[A-Z]/.test(key)) expectedClientTags.add(key)
  }

  expect([...CLIENT_BUILTIN_COMPONENT_TAGS].sort()).toEqual([...expectedClientTags].sort())
})

describe('sanity', () => {
  it('found at least one use-client mdx file to compare against', () => {
    const clientFiles = readdirSync(mdxDir).filter((f) => f.endsWith('.tsx') && isClientDirectiveFile(f))
    expect(clientFiles.length).toBeGreaterThan(0)
  })

  it('resolves a multi-line arrow wrapper the same as a single-line one', () => {
    const source = "const components = {\n  Accordion: (props) => (\n    <Accordion {...props} />\n  ),\n}\n"
    const sourceFile = parse(source, 'inline.tsx')
    const entries = registryEntries(sourceFile)
    expect(entries.get('Accordion')).toBe('Accordion')
  })

  it('resolves a component wrapped in a div or fragment in a multi-line arrow entry', () => {
    const source = "const components = {\n  Tabs: (props) => (\n    <div className=\"x\">\n      <Tabs {...props} />\n    </div>\n  ),\n  Tab: (props) => (\n    <>\n      {<Tab {...props} />}\n    </>\n  ),\n}\n"
    const entries = registryEntries(parse(source, 'inline.tsx'))
    expect(entries.get('Tabs')).toBe('Tabs')
    expect(entries.get('Tab')).toBe('Tab')
  })

  it('resolves an aliased import to its real module specifier', () => {
    const source = "import { Accordion as Foo } from '@/components/mdx/accordion'\n"
    const sourceFile = parse(source, 'inline.tsx')
    const bindings = importedBindings(sourceFile)
    expect(bindings.get('Foo')).toBe('@/components/mdx/accordion')
  })

  it('detects a `\'use client\'` directive prologue even when it is not the literal first source line', () => {
    const content = "// a leading comment\n'use client'\n\nexport const X = 1\n"
    const sourceFile = parse(content, 'inline.tsx')
    const first = sourceFile.statements[0]
    expect(ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client').toBe(true)
  })
})
