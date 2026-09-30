/**
 * Give a page's inline `export const Widget = () => {...}` component access
 * to Thally's registered MDX components (built-ins and customer-registered
 * alike), the same way the page body already resolves them.
 *
 * `@mdx-js/mdx` only wires its components map into `_createMdxContent`, the
 * function compiled from the page's own top-level Markdown/JSX. A component
 * the author declares separately — a real, standalone top-level function —
 * is ordinary JavaScript: a JSX reference inside it to a name that isn't
 * imported or locally declared (for example `Icon`) compiles to a bare,
 * unbound identifier and throws at render time. Since `MDXContent` already
 * receives the full registry as `props.components`, this rewrites the
 * compiled program to stash that registry in a module-level binding when
 * `MDXContent` runs, and has every such inline component destructure
 * whichever names it references from that binding at call time — after
 * `MDXContent` has necessarily already run once.
 */
import ts from 'typescript'

const JSX_CALL_NAMES = new Set(['_jsx', '_jsxs', '_jsxDEV'])
const RUNTIME_REFS = '_mdxRuntimeRefs'

function sourceFile(text: string): ts.SourceFile {
  return ts.createSourceFile('program.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function isExported(statement: ts.Statement): boolean {
  return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

function isDefaultExport(statement: ts.Statement): boolean {
  return (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false
}

function bindName(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) into.add(name.text)
  else for (const element of name.elements) if (ts.isBindingElement(element)) bindName(element.name, into)
}

/** Every name bound at module scope: imports, and top-level declarations. */
function collectModuleScopeNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause
      if (clause.name) names.add(clause.name.text)
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text)
        else for (const element of clause.namedBindings.elements) names.add(element.name.text)
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) names.add(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bindName(declaration.name, names)
    }
  }
  return names
}

/** Every name bound anywhere inside a function's own scope (params, locals). */
function collectLocalNames(body: ts.Node): Set<string> {
  const names = new Set<string>()
  function visit(node: ts.Node): void {
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && node.name) {
      bindName(node.name, names)
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) && node.name) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return names
}

/** Capitalized identifiers passed as the tag to a compiled JSX call, free of any binding. */
function collectFreeJsxReferences(body: ts.Node, moduleScopeNames: Set<string>): Set<string> {
  const localNames = collectLocalNames(body)
  const free = new Set<string>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && JSX_CALL_NAMES.has(node.expression.text)) {
      const tag = node.arguments[0]
      if (tag && ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)
        && !localNames.has(tag.text) && !moduleScopeNames.has(tag.text)) free.add(tag.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return free
}

interface Insertion { position: number; text: string }

function functionBody(node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): ts.ConciseBody | ts.Block | undefined {
  return node.body
}

/** Insert `text` as the first statement of a block, or wrap a concise arrow body. */
function prependToBody(body: ts.ConciseBody | ts.Block, destructure: string, insertions: Array<Insertion>): void {
  if (ts.isBlock(body)) {
    insertions.push({ position: body.getStart() + 1, text: `\n  ${destructure}` })
    return
  }
  // A concise (expression-bodied) arrow: `() => <Icon />` becomes
  // `() => { <destructure>; return (<Icon />) }`.
  insertions.push({ position: body.getStart(), text: `{ ${destructure} return (` })
  insertions.push({ position: body.getEnd(), text: ') }' })
}

/**
 * Rewrite a compiled MDX program so every page-local inline component can
 * resolve a registered built-in it references, without any caller needing
 * to know which built-ins exist or where they live.
 */
export function injectScopedComponentReferences(programText: string): string {
  const file = sourceFile(programText)
  const moduleScopeNames = collectModuleScopeNames(file)
  const insertions: Array<Insertion> = []
  let mdxContentBody: ts.Block | undefined

  for (const statement of file.statements) {
    if (!isExported(statement)) continue
    if (isDefaultExport(statement) && ts.isFunctionDeclaration(statement) && statement.name?.text === 'MDXContent' && statement.body) {
      mdxContentBody = statement.body
      continue
    }
    let fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined
    if (ts.isFunctionDeclaration(statement)) fn = statement
    else if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
      const initializer = statement.declarationList.declarations[0].initializer
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) fn = initializer
    }
    if (!fn) continue
    const body = functionBody(fn)
    if (!body) continue
    const free = collectFreeJsxReferences(body, moduleScopeNames)
    if (free.size === 0) continue
    prependToBody(body, `const { ${[...free].sort().join(', ')} } = ${RUNTIME_REFS};`, insertions)
  }

  if (insertions.length === 0) return programText
  if (mdxContentBody) {
    insertions.push({ position: mdxContentBody.getStart() + 1, text: `\n  ${RUNTIME_REFS} = props.components || {};` })
  }
  // Declare after the last import rather than at the very top: harmless
  // either way once loaded, but keeps every import textually leading.
  const lastImport = [...file.statements].reverse().find((statement) => ts.isImportDeclaration(statement))
  insertions.push({ position: lastImport ? lastImport.getEnd() : 0, text: `\nlet ${RUNTIME_REFS} = {};` })
  insertions.sort((a, b) => a.position - b.position)
  let result = ''
  let cursor = 0
  for (const insertion of insertions) {
    result += programText.slice(cursor, insertion.position) + insertion.text
    cursor = insertion.position
  }
  return result + programText.slice(cursor)
}
