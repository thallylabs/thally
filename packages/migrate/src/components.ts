/**
 * Move repository-owned MDX components into the customer component registry.
 * Source is parsed, never evaluated. Every dependency must remain inside the
 * documentation root and traverse only ordinary files (including its parents).
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import ts from 'typescript'
import { unified } from 'unified'

import { parseFrontmatter } from './frontmatter.js'
import { resolveWithin } from './path.js'
import type { MigrationWarning, RenderedMigrationFile } from './types.js'

interface MdxNode {
  type: string
  name?: string | null
  value?: string
  attributes?: Array<{ name?: string; type: string; value?: string | { value?: string } | null }>
  children?: Array<MdxNode>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

interface Replacement { start: number; end: number; value: string }
interface Binding { local: string; imported: string; source: string }

const parser = unified().use(remarkParse).use(remarkMdx)
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])
const DATA_EXTENSIONS = new Set(['.json', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.woff', '.woff2'])
const SHARED_IMPORTS = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'])
const REACT_GLOBALS = new Set([
  'useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useRef',
  'useReducer', 'useContext', 'useId', 'useTransition', 'useDeferredValue',
  'useImperativeHandle', 'useSyncExternalStore', 'useInsertionEffect',
  'useOptimistic', 'useActionState', 'use', 'createContext', 'forwardRef', 'memo',
])
const MAX_COMPONENT_FILES = 300
const MAX_COMPONENT_BYTES = 20_000_000
const MAX_FILE_BYTES = 2_000_000

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
  return [
    references.has('React') && !bindings.has('React') ? "import * as React from 'react';" : '',
    hooks.length ? `import { ${hooks.join(', ')} } from 'react';` : '',
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

/** Create one bounded component graph and registry for a repository migration. */
export function createComponentMigrator(siteRoot: string, warnings: Array<MigrationWarning>, sourceIdentity: string): {
  transform: (raw: string, currentFile: string) => string
  files: () => Array<RenderedMigrationFile>
} {
  const root = resolve(siteRoot)
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
    const local = relative(root, path)
    resolveWithin(root, local)
    let current = root
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
      : resolveWithin(root, relative(root, resolve(dirname(importer), specifier)))
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
    return `${destinationRoot}/source/${relative(root, path).replace(/\\/g, '/')}`
  }

  function copyGraph(entry: string): string {
    // Stage the entire graph in memory. A missing leaf must not leave a partly
    // registered component or consume the successful-copy budget.
    const staged = new Map<string, RenderedMigrationFile>()
    let stagedBytes = 0
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
      function dependency(literal: ts.StringLiteralLike): void {
        const specifier = literal.text
        if (SHARED_IMPORTS.has(specifier)) return
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
          throw new Error(`external package ${specifier} requires manual installation and review`)
        }
        const target = resolveDependency(specifier, path)
        visit(target)
        const nextPath = relative(dirname(destination), outputPath(target)).replace(/\\/g, '/')
        edits.push({ start: literal.getStart(ast), end: literal.end, value: JSON.stringify(portableSpecifier(nextPath.startsWith('.') ? nextPath : `./${nextPath}`)) })
      }
      function inspect(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier)
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

  function register(path: string, imported: string): string {
    const name = `Migrated${hash(`${path}:${imported}`)}`
    registrations.set(name, { path, imported })
    return name
  }

  function transform(raw: string, currentFile: string): string {
    const content = parseFrontmatter(raw).content
    const frontmatter = raw.slice(0, raw.length - content.length)
    let tree: MdxNode
    try {
      tree = parser.parse(content) as MdxNode
    } catch {
      warn('Custom component analysis could not parse this MDX; its source was preserved for manual migration.', currentFile)
      return raw
    }
    const aliases = new Map<string, string>()
    const edits: Array<Replacement> = []
    const declarations: Array<{ start: number; end: number; source: string }> = []
    const moduleImports: Array<string> = []
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
    for (const node of tree.children ?? []) {
      if (node.type !== 'mdxjsEsm' || node.value === undefined || node.position?.start.offset === undefined) continue
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
        const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ''
        if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
          if (SHARED_IMPORTS.has(specifier)) {
            moduleImports.push(statement.getText(ast))
            sharedImportEdits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
          } else {
            hasUnsupportedImports = true
            warn(`MDX import ${specifier} requires manual package installation or registration; the import was preserved.`, currentFile)
          }
          continue
        }
        if (/\.mdx?$/.test(specifier)) continue
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
        if (hasExpressionReference(new Set(bindings.map((binding) => binding.local)))) {
          warn('Imported components used in MDX expressions, component props, or member tags require manual migration; the import was preserved.', currentFile)
          hasUnsupportedImports = true
          continue
        }
        try {
          const path = copyGraph(resolveDependency(specifier, currentFile))
          for (const binding of bindings) {
            const name = register(path, binding.imported)
            aliases.set(binding.local, name)
            moduleImports.push(`import { ${binding.imported} as ${binding.local} } from ${JSON.stringify(portableSpecifier(`./${relative(destinationRoot, path).replace(/\\/g, '/')}`))};`)
          }
          edits.push({ start: node.position.start.offset + statement.getStart(ast), end: node.position.start.offset + statement.end, value: '' })
        } catch (error) {
          hasUnsupportedImports = true
          warn(`Custom component was preserved for manual migration: ${error instanceof Error ? error.message : 'unsupported dependency'}.`, currentFile)
        }
      }
    }

    // Extract whole HTML JSX roots with event handlers. Markdown and global
    // built-ins remain server-rendered; React functions stay inside the client
    // module, so no function is serialized across a server/client boundary.
    const extracted: Array<{ node: MdxNode; name: string; jsx: string }> = []
    for (const candidate of tree.children ?? []) {
      const node = candidate.type === 'paragraph' && candidate.children?.length === 1 ? candidate.children[0] : candidate
      if (!['mdxJsxFlowElement', 'mdxJsxTextElement'].includes(node.type) || node.position?.start.offset === undefined || node.position.end.offset === undefined) continue
      let interactive = false
      let supported = true
      walk(node, (child) => {
        if (child.attributes?.some((attribute) => /^on[A-Z]/.test(attribute.name ?? ''))) interactive = true
        if (child.name && /^[A-Z]/.test(child.name) && !aliases.has(child.name)) supported = false
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
        "'use client';", '', ...moduleImports, '', declarationSource, '',
        ...extracted.map(({ name, jsx }) => `export function ${name}() {\n  return (${jsx});\n}`), '',
      ].join('\n')
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
    return frontmatter + applyReplacements(content, edits)
  }

  function files(): Array<RenderedMigrationFile> {
    if (!registrations.size) return []
    const entries = [...registrations.entries()].sort(([a], [b]) => a.localeCompare(b))
    return [...copied.values(), {
      path: 'src/mdx/custom-components.tsx',
      content: [
        '/** Repository components preserved by migration; this registry is customer-owned. */',
        "import type { MDXComponents } from 'mdx/types'", ...entries.map(([name, binding]) => {
          const path = portableSpecifier(`./${relative('src/mdx', binding.path).replace(/\\/g, '/')}`)
          return `import { ${binding.imported} as ${name} } from ${JSON.stringify(path)}`
        }), '', 'export const customComponents: MDXComponents = {',
        ...entries.map(([name]) => `  ${name},`), '}', '',
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
