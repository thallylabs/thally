/** Markdown/MDX normalization that preserves every component Thally supports. */

import type * as acorn from 'acorn'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { isThallyBuiltinComponent } from './builtin-components.js'
import { parseFrontmatter } from './frontmatter.js'
import type { MigrationPage, MigrationPlatform } from './types.js'

export interface MarkdownPageIdentity {
  id: string
  navigationId: string
  locale?: string
}

function titleFromId(id: string): string {
  const value = id.split('/').at(-1) ?? id
  if (value === 'introduction') return 'Introduction'
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface DescriptionNode {
  type: string
  value?: string
  alt?: string | null
  children?: Array<DescriptionNode>
}

const descriptionParser = unified().use(remarkParse).use(remarkMdx)

function firstParagraph(content: string): string {
  function plainText(node: DescriptionNode): string {
    if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
    if (node.type === 'image') return node.alt ?? ''
    if (node.type === 'break') return ' '
    return (node.children ?? []).map(plainText).join('')
  }
  function findParagraph(node: DescriptionNode): string {
    if (node.type === 'paragraph') {
      const value = plainText(node).replace(/\s+/g, ' ').trim()
      if (value) return value.slice(0, 240)
    }
    for (const child of node.children ?? []) {
      const value = findParagraph(child)
      if (value) return value
    }
    return ''
  }
  // Component wrappers, imports, expressions, and code fences are syntax, not
  // description copy. Reading paragraph nodes also finds prose nested inside
  // accordions without leaking their closing tags into page metadata.
  try {
    return findParagraph(descriptionParser.parse(content) as DescriptionNode)
  } catch {
    // Unparseable source is already retained for the migration validator. An
    // empty generated description is safer than exposing source-code fragments.
    return ''
  }
}

function docusaurusAdmonitionTag(kind: string): 'Error' | 'Info' | 'Note' | 'Warning' {
  if (kind === 'danger') return 'Error'
  if (kind === 'info') return 'Info'
  if (kind === 'caution' || kind === 'warning') return 'Warning'
  return 'Note'
}

/**
 * Convert Docusaurus' colon-fence admonitions without interpreting code-fence
 * contents. Longer delimiters support nested admonitions in the same way as
 * the source renderer.
 */
function normalizeDocusaurusAdmonitions(body: string): string {
  const lines = body.split('\n')
  const openAdmonitions: Array<{ delimiter: string; tag: string }> = []
  let codeFence: string | null = null

  return lines.map((line) => {
    const codeMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeMatch) {
      if (!codeFence) codeFence = codeMatch[1][0]
      else if (codeMatch[1][0] === codeFence) codeFence = null
      return line
    }
    if (codeFence) return line

    const opening = line.match(/^\s*(:{3,})(note|tip|info|warning|caution|danger)(?:\[([^\]]+)\]|\s+(.+))?\s*$/i)
    if (opening) {
      const tag = docusaurusAdmonitionTag(opening[2].toLowerCase())
      openAdmonitions.push({ delimiter: opening[1], tag })
      const title = (opening[3] ?? opening[4])?.trim()
      return title ? `<${tag}>\n**${title}**` : `<${tag}>`
    }

    const closing = line.match(/^\s*(:{3,})\s*$/)
    const current = openAdmonitions.at(-1)
    if (closing && current?.delimiter === closing[1]) {
      openAdmonitions.pop()
      return `</${current.tag}>`
    }
    return line
  }).join('\n')
}

const GLOBAL_DOCUSARUS_COMPONENTS = new Set([
  'Tabs',
  'TabItem',
  'Link',
  'DocCardList',
  'TOCInline',
])

/** Match the one simple import form Docusaurus injects without backtracking. */
function isGlobalDocusaurusImport(line: string): boolean {
  const trimmed = line.trim().replace(/;$/, '').trimEnd()
  if (!trimmed.startsWith('import ')) return false
  const separator = trimmed.indexOf(' from ', 'import '.length)
  if (separator < 0) return false
  const component = trimmed.slice('import '.length, separator).trim()
  if (!GLOBAL_DOCUSARUS_COMPONENTS.has(component)) return false
  const source = trimmed.slice(separator + ' from '.length)
  if (source.length < 3) return false
  const quote = source[0]
  if ((quote !== "'" && quote !== '"') || source.at(-1) !== quote) return false
  const moduleName = source.slice(1, -1)
  return moduleName.startsWith('@theme/') || moduleName.startsWith('@docusaurus/')
}

const JS_LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined'])
// A leading identifier segment (`x` in `x.y.z`) may be any valid JS/Unicode
// identifier, not just ASCII — `{café}`, `{$var}` are both real bare
// references a page's own ESM could bind, and Fern's literal-brace prose
// (the thing this whole pass is trying to leave alone) never happens to
// look like one, so escaping stays conservative either way.
const BARE_IDENTIFIER_PATH = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*(?:\.[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)*$/u
/**
 * Pure JS built-ins that exist identically in the server and browser render.
 * Only a dotted path rooted at one (`{Math.PI}`, `{Number.MAX_SAFE_INTEGER}`)
 * is left as a live expression. A bare name (`{window}`, `{Date}`,
 * `{console}`) is always escaped: it would render an object/function (a
 * React crash or silently empty text), and host globals such as `window`,
 * `document`, `navigator`, or `process` do not exist on both sides at all.
 */
const SAFE_BUILTIN_ROOTS = new Set([
  'Math', 'JSON', 'Number', 'String', 'Object', 'Array', 'Intl', 'Boolean', 'Symbol', 'BigInt', 'Reflect',
])

interface MdxOffsetNode {
  type: string
  value?: string
  name?: string | null
  data?: { estree?: acorn.Program | null }
  children?: Array<MdxOffsetNode>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

/** Recursively collects every name a binding pattern introduces (`{a, b: {c}}`, `[p, ...rest]`, `x = 1`). */
function collectPatternNames(pattern: acorn.AnyNode, names: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier':
      names.add((pattern as acorn.Identifier).name)
      break
    case 'ObjectPattern':
      for (const property of (pattern as acorn.ObjectPattern).properties) {
        collectPatternNames(property.type === 'RestElement' ? property.argument : property.value, names)
      }
      break
    case 'ArrayPattern':
      for (const element of (pattern as acorn.ArrayPattern).elements) {
        if (element) collectPatternNames(element, names)
      }
      break
    case 'AssignmentPattern':
      collectPatternNames((pattern as acorn.AssignmentPattern).left, names)
      break
    case 'RestElement':
      collectPatternNames((pattern as acorn.RestElement).argument, names)
      break
    default:
      break
  }
}

/** Adds the name(s) a single top-level declaration statement introduces (`const`/`let`/`var`, `function`, `class`). */
function collectDeclarationNames(node: acorn.AnyNode | null | undefined, names: Set<string>): void {
  if (!node) return
  if (node.type === 'VariableDeclaration') {
    for (const declarator of (node as acorn.VariableDeclaration).declarations) collectPatternNames(declarator.id, names)
  } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && (node as acorn.FunctionDeclaration | acorn.ClassDeclaration).id) {
    names.add(((node as acorn.FunctionDeclaration | acorn.ClassDeclaration).id as acorn.Identifier).name)
  }
}

/**
 * Bind every name a page's own ESM statement introduces — an import
 * (default, namespace, or named/destructured, however deeply nested its
 * destructuring goes), or a top-level `const`/`let`/`var`/`function`/`class`
 * — so a prose brace referencing one of them is treated as real,
 * already-bound code rather than ambiguous Fern prose. Read from the ESTree
 * remark-mdx attaches to the `mdxjsEsm` node (real ESM syntax including JSX,
 * not a regex approximation), so `export const a = 1, b = 2`, nested
 * destructuring, and multi-declarator statements all resolve
 * correctly. `export { x } from './y'` (a re-export) and a local `export {
 * x }` (which only re-exposes an already-declared local) never introduce a
 * new binding, so neither is added here — matching real JS module
 * semantics, since referencing `x` in prose is exactly as undefined as it
 * would be in the compiled component.
 */
function collectEsmBindings(node: MdxOffsetNode, declared: Set<string>): void {
  // remark-mdx already parsed this ESM (with JSX support) and keeps the
  // result on the node; re-parsing it with plain acorn fails on any JSX.
  const program = node.data?.estree
  if (!program) {
    collectEsmBindingsByPattern(node.value ?? '', declared)
    return
  }
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) declared.add(specifier.local.name)
    } else if (statement.type === 'ExportNamedDeclaration') {
      collectDeclarationNames(statement.declaration, declared)
    } else if (statement.type === 'ExportDefaultDeclaration') {
      collectDeclarationNames(statement.declaration, declared)
    } else {
      collectDeclarationNames(statement, declared)
    }
  }
}

/**
 * Fallback when no parsed ESM tree is available: collect simple declared and
 * imported names by pattern, so the page's own bindings are still recognized.
 * Approximate (destructuring is not followed, nested declarations are
 * included), but never records nothing for a page that does bind names.
 */
function collectEsmBindingsByPattern(source: string, declared: Set<string>): void {
  for (const match of source.matchAll(/\b(?:const|let|var|class|function\s*\*?)\s+([\p{ID_Start}$_][\p{ID_Continue}$]*)/gu)) declared.add(match[1])
  for (const match of source.matchAll(/\bimport\s+([^'";]*?)\s+from\b/g)) {
    const clause = match[1]
    for (const name of clause.replace(/\{[^}]*\}/, '').matchAll(/(?:\*\s+as\s+)?([\p{ID_Start}$_][\p{ID_Continue}$]*)/gu)) declared.add(name[1])
    for (const entry of clause.match(/\{([^}]*)\}/)?.[1].split(',') ?? []) {
      const local = entry.trim().split(/\s+as\s+/).at(-1)?.trim()
      if (local) declared.add(local)
    }
  }
}

/**
 * Fern's own MDX renderer tolerates a bare `{word}` in prose as literal text
 * (e.g. `"connection to {vendor} failed"`, `<Note>connection to {vendor}
 * failed</Note>`); Thally's MDX pipeline evaluates `{...}` as a JS expression
 * and throws `ReferenceError` when the identifier isn't defined. `{vendor}`
 * is syntactically valid MDX either way — a text expression — so the fix
 * isn't a character scan but telling real code from prose: parse the page,
 * then escape a bare identifier/dotted-path text expression
 * (`mdxTextExpression`/`mdxFlowExpression`) anywhere in the body tree,
 * including inside a JSX element's children (a `<Note>`/`<Tabs>` callout is
 * the common Fern case) — but never a JSX *attribute* expression
 * (`prop={x}`, which lives on the node's `attributes`, not its `children`,
 * and this walk never visits it), never ESM, never code. Real component
 * code — `{items.map((item) => <li>{item}</li>)}` — parses as a single
 * expression node whose JSX lives only in its `estree`, not as further mdast
 * children, so this walk cannot (and must not) descend into it and escape
 * the inner `{item}`; only a leaf expression node with every mdast ancestor
 * being JSX/markdown is ever a candidate. `props` (MDX's implicit prop) and
 * anything the page's own ESM imports or declares are exempt. A page whose
 * source doesn't parse is left untouched; the migration's MDX-compile check
 * reports the real problem instead.
 */
/** Trimmed line begins a fenced code block (```` ``` ```` or `~~~`, 3+ characters). */
const FENCE_OPEN = /^(`{3,}|~{3,})/

/**
 * KaTeX-style `$$...$$` math (block, on its own lines, or inline mid-
 * paragraph) is common in Fern docs (and any other Markdown source) but has
 * no Thally renderer (no `remark-math`/`rehype-katex`) — worse, the raw
 * LaTeX inside (`\begin{align*}`, bare `{...}`) crashes the MDX parser
 * before `escapeFernLiteralBraces` below even gets a chance to run, so the
 * whole page fails to compile and is silently excluded. Content is
 * preserved, never dropped: a block becomes a fenced ` ```math ` code
 * block, an inline span becomes an inline code span — both opaque to MDX's
 * `{...}` expression parsing. This is a plain line scan (not an MDX parse,
 * which is exactly what the source can't survive yet) that tracks fenced
 * code blocks so a real code sample's own `$$` is never touched, and must
 * run before any MDX-aware pass.
 */
export function protectMathBlocks(raw: string): { body: string; converted: boolean } {
  const { front, body } = splitFrontmatterBlock(raw)
  const lines = body.split(/\r\n|\r|\n/)
  const output: Array<string> = []
  let inFence = false
  let fenceToken = ''
  // Fern also allows a block delimited by a bare `$` alone on its own line
  // (not just `$$`), e.g. `$\n\text{...}\n$`; a block must close on the
  // same delimiter that opened it.
  let mathBlockDelimiter: '$$' | '$' | null = null
  let mathLines: Array<string> = []
  let converted = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (mathBlockDelimiter) {
      if (trimmed === mathBlockDelimiter) {
        output.push('```math', ...mathLines, '```')
        mathBlockDelimiter = null
        mathLines = []
        converted = true
      } else {
        mathLines.push(line)
      }
      continue
    }
    if (inFence) {
      if (trimmed.startsWith(fenceToken)) inFence = false
      output.push(line)
      continue
    }
    const fenceOpen = FENCE_OPEN.exec(trimmed)
    if (fenceOpen) {
      inFence = true
      fenceToken = fenceOpen[1].slice(0, 3)
      output.push(line)
      continue
    }
    if (trimmed === '$$' || trimmed === '$') {
      mathBlockDelimiter = trimmed
      continue
    }
    if (line.includes('$')) {
      // One combined pass, `$$...$$` tried before single-`$...$` at each
      // position: doing these as two sequential passes let the second
      // (single-`$`) regex re-match dollar signs the first pass had just
      // wrapped in backticks, corrupting its own output. Single-`$` inline
      // math (the other half of the KaTeX convention, e.g. `$F = S \times
      // e^{\,f\,T}$`) only counts when its content doesn't start/end with
      // whitespace and holds no further `$` — the same rule KaTeX/Pandoc
      // use to tell real inline math from an ordinary sentence mentioning
      // two dollar amounts (`$50 and $100`, whose span content ends in a
      // space and so never matches). An author-escaped `\$` (a literal
      // dollar sign) is never treated as a delimiter.
      const updated = line.replace(
        /\$\$([^\n]+?)\$\$|(?<!\\)\$([^\s$](?:[^$\n]*[^\s$])?)\$/g,
        (_whole, block: string | undefined, inline: string | undefined) => {
          converted = true
          return block !== undefined ? `\`$$${block}$$\`` : `\`$${inline}$\``
        },
      )
      output.push(updated)
      continue
    }
    output.push(line)
  }
  // An unterminated `$$` block means the source was malformed to begin
  // with; leave it untouched rather than eating the rest of the page into
  // one giant fenced block.
  if (mathBlockDelimiter) return { body: raw, converted: false }
  return { body: front + output.join('\n'), converted }
}

export function escapeFernLiteralBraces(raw: string): string {
  // Never touch the YAML frontmatter block: its `{...}` values (e.g. a
  // description containing a literal brace) are YAML scalars, not MDX
  // expressions, and running the MDX parser over them corrupts the block.
  // Split it off first — mirroring `parseFrontmatter`'s own delimiter
  // handling, including a leading BOM and CRLF line endings, which a naive
  // `/^---\n/` guard misses and lets the frontmatter get parsed as MDX.
  const { front, body } = splitFrontmatterBlock(raw)

  let root: MdxOffsetNode
  try {
    root = descriptionParser.parse(body) as MdxOffsetNode
  } catch {
    return raw
  }

  const declared = new Set<string>(['props'])
  const collectEsm = (node: MdxOffsetNode) => {
    if (node.type === 'mdxjsEsm') collectEsmBindings(node, declared)
    for (const child of node.children ?? []) collectEsm(child)
  }
  collectEsm(root)

  const edits: Array<{ start: number; end: number; value: string }> = []
  const visit = (node: MdxOffsetNode) => {
    if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') {
      const value = (node.value ?? '').trim()
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      const root = value.split('.')[0]
      const safeBuiltinPath = value.includes('.') && SAFE_BUILTIN_ROOTS.has(root)
      if (BARE_IDENTIFIER_PATH.test(value) && !JS_LITERAL_KEYWORDS.has(value)
        && !declared.has(root) && !safeBuiltinPath && start !== undefined && end !== undefined) {
        edits.push({ start, end, value: `\\{${value}\\}` })
      }
      // A leaf node: mdast never gives it further `children` (its JSX, if
      // any, lives only inside `data.estree`), so there is nothing to recurse into.
      return
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(root)
  if (edits.length === 0) return raw

  const escapedBody = edits
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => `${result.slice(0, edit.start)}${edit.value}${result.slice(edit.end)}`, body)
  return front + escapedBody
}

/**
 * Split `raw` into its untouched YAML frontmatter block (including a leading
 * BOM, if present) and the remaining MDX body, using the same delimiter
 * rules as `parseFrontmatter` (BOM-aware, CRLF-safe) so the two always agree
 * on where the frontmatter ends. Unlike `parseFrontmatter`, this returns the
 * frontmatter block verbatim (not parsed) because callers here only need to
 * avoid rewriting it, not read its values.
 */
function splitFrontmatterBlock(raw: string): { front: string; body: string } {
  const hasBom = raw.charCodeAt(0) === 0xfeff
  const bom = hasBom ? raw[0] : ''
  const source = hasBom ? raw.slice(1) : raw
  const opening = /^---([^\r\n]*)\r?\n/.exec(source)
  if (!opening || opening[1].startsWith('-')) return { front: bom, body: source }
  const remainder = source.slice(opening[0].length)
  const closing = /^---[ \t]*\r?$/m.exec(remainder)
  if (!closing) return { front: bom, body: source }
  const end = opening[0].length + closing.index + closing[0].length
  return { front: bom + source.slice(0, end), body: source.slice(end) }
}

/**
 * `components.ts`'s `createComponentMigrator` renames a successfully copied
 * or extracted component's JSX tag to `Migrated<12-hex-char-hash>` and
 * registers it in the project-wide `src/mdx/custom-components.tsx` (merged
 * into every page by `mdx-components.tsx`, not imported per-page) — so a
 * page's own ESM never mentions it, even though it does resolve. Recognize
 * the naming convention rather than re-deriving it from `components.ts`,
 * which would need this module to depend on that one's private `hash()`.
 */
const MIGRATED_COMPONENT_TAG = /^Migrated[0-9a-f]{12}$/

/** True when the JSX span itself (not merely its opening tag) is self-closing, e.g. `<Foo />`. */
function isSelfClosingJsx(text: string): boolean {
  return /\/>\s*$/.test(text)
}

/** Replace the leading `<name` / trailing `</name` occurrences of a tag with `newName`, for a tag with no children to preserve (self-closing, or an empty pair). */
function renameTagOccurrences(text: string, name: string, newName: string): string {
  let result = text
  const openIndex = result.indexOf(`<${name}`)
  if (openIndex >= 0) result = `${result.slice(0, openIndex + 1)}${newName}${result.slice(openIndex + 1 + name.length)}`
  const closeIndex = result.lastIndexOf(`</${name}`)
  if (closeIndex >= 0) result = `${result.slice(0, closeIndex + 2)}${newName}${result.slice(closeIndex + 2 + name.length)}`
  return result
}

/**
 * Reconstructs `body.slice(loStart, hiEnd)` verbatim except through
 * `renderNode` at each of `children`'s own spans — the gaps between/around
 * them (markdown or JSX syntax the children's own positions don't cover,
 * such as a parent JSX element's attributes) are copied through unchanged.
 */
function renderChildrenSpan(
  children: Array<MdxOffsetNode>,
  loStart: number,
  hiEnd: number,
  body: string,
  renderNode: (node: MdxOffsetNode) => string,
): string {
  let cursor = loStart
  let out = ''
  for (const child of children) {
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (start === undefined || end === undefined) continue
    out += body.slice(cursor, start)
    out += renderNode(child)
    cursor = end
  }
  out += body.slice(cursor, hiEnd)
  return out
}

/**
 * Replaces a page-authored (or Docusaurus/Fern-only) `<Link href="...">`
 * with a plain `<a href="...">`, keeping every attribute and all children
 * exactly as authored — only the tag name changes, so nested content
 * (including any unknown component the fallback below also rewrites) is
 * preserved. A page that declares or imports its own `Link` keeps it
 * untouched; that binding, not this generic one, is what actually renders.
 */
export function replaceLinkWithAnchor(raw: string): string {
  return replaceUnknownComponents(raw, () => {}, { onlyRenameLinkTag: true })
}

/**
 * Fallback for any capitalized JSX tag Thally cannot render: not a builtin
 * (`isThallyBuiltinComponent`) and not declared or imported by the page
 * itself. Mintlify/Docusaurus content commonly references a project-local or
 * npm component that `components.ts`'s copy step already handles when it can
 * be resolved — this only ever fires for what's left: a name with nothing
 * backing it at all, which would otherwise throw "Expected component X to be
 * defined" at render. A paired tag becomes a plain `<div>`, keeping its
 * children (so nested prose/markup survives); a self-closing tag is removed
 * outright, since it has no content to keep. `warn` is called once per
 * distinct component name found. `<Link>` is renamed to `<a>` instead of
 * falling into that generic path, since it's common enough to warrant a
 * real mapping (Mintlify/Docusaurus content routinely writes `<Link
 * href="...">`) rather than losing the link.
 *
 * Frontmatter is split off first (see `escapeFernLiteralBraces`) so a YAML
 * value can never be mistaken for JSX.
 */
export function replaceUnknownComponents(
  raw: string,
  warn: (name: string) => void,
  options: { onlyRenameLinkTag?: boolean } = {},
): string {
  const { front, body } = splitFrontmatterBlock(raw)

  let root: MdxOffsetNode
  try {
    root = descriptionParser.parse(body) as MdxOffsetNode
  } catch {
    return raw
  }

  const declared = new Set<string>(['props'])
  const collectEsm = (node: MdxOffsetNode) => {
    if (node.type === 'mdxjsEsm') collectEsmBindings(node, declared)
    for (const child of node.children ?? []) collectEsm(child)
  }
  collectEsm(root)

  const warned = new Set<string>()
  const renderNode = (node: MdxOffsetNode): string => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start === undefined || end === undefined) return ''
    const isJsx = node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement'
    const tagRoot = node.name ? node.name.split('.')[0] : undefined
    const text = body.slice(start, end)

    if (isJsx && tagRoot === 'Link' && !declared.has('Link')) {
      if (isSelfClosingJsx(text) || !node.children?.length) return renameTagOccurrences(text, node.name!, 'a')
      const openEnd = node.children[0].position?.start.offset ?? start
      const closeStart = node.children.at(-1)!.position?.end.offset ?? end
      return renameTagOccurrences(body.slice(start, openEnd), node.name!, 'a')
        + renderChildrenSpan(node.children, openEnd, closeStart, body, renderNode)
        + renameTagOccurrences(body.slice(closeStart, end), node.name!, 'a')
    }

    if (!options.onlyRenameLinkTag && isJsx && tagRoot && /^[A-Z]/.test(tagRoot)
      && !isThallyBuiltinComponent(node.name!) && !declared.has(tagRoot) && !MIGRATED_COMPONENT_TAG.test(tagRoot)) {
      if (!warned.has(node.name!)) {
        warned.add(node.name!)
        warn(node.name!)
      }
      if (isSelfClosingJsx(text)) return ''
      if (!node.children?.length) return '<div></div>'
      const openEnd = node.children[0].position?.start.offset ?? start
      const closeStart = node.children.at(-1)!.position?.end.offset ?? end
      const children = renderChildrenSpan(node.children, openEnd, closeStart, body, renderNode)
      // A flow (block-level) unknown component can wrap block content —
      // a fenced code block, a heading, another flow element — and MDX
      // only recognizes that as block content when it's set off from the
      // surrounding tag by a blank line; gluing it straight onto `<div>`
      // (the previous behavior) reads as inline text, which derails the
      // parser and can surface as an unrelated "unclosed `<div>`" error
      // once it hits the real closing tag. The source component's own
      // markup may have had no blank line there at all (a permissive
      // renderer doesn't require one), so always add it rather than
      // trying to detect when it's needed. An inline (text-level) unknown
      // component never contains block content, so it stays glued.
      return node.type === 'mdxJsxFlowElement' ? `<div>\n\n${children}\n\n</div>` : `<div>${children}</div>`
    }

    if (!node.children?.length) return text
    return renderChildrenSpan(node.children, start, end, body, renderNode)
  }

  return front + renderNode(root)
}

/**
 * Replace every fenced code block and inline `code span` in `body` with an
 * opaque single-line placeholder, so a textual rename can run as one pass
 * over the WHOLE body — including a tag or comment that spans multiple
 * lines — without ever matching inside code, then restore the original code
 * text afterward. A rename that only ever sees one line at a time (the old
 * approach) misses anything spanning lines: a `<!--\n...\n-->` comment, a
 * `<Warn\n  title="x">` opening tag whose `</Warn>` gets renamed with no
 * matching open, a Docusaurus `<Link\n  to="/a">` likewise. Every rename in
 * this module that isn't already AST-based goes through this one masker
 * instead of re-implementing fence tracking.
 */
function maskCode(body: string): { masked: string; unmask: (text: string) => string } {
  // NUL is never valid in MDX; strip it so it can't collide with the \u0000
  // placeholder markers stashed below.
  const source = body.replace(/\u0000/g, '')

  const blocks: Array<string> = []
  const stash = (text: string): string => {
    blocks.push(text)
    return `\u0000${blocks.length - 1}\u0000`
  }

  const lines: Array<string> = []
  let codeFence: string | null = null
  let fenceBuffer: Array<string> = []
  // Note: MDX (mdx-js) disables CommonMark indented code blocks, so
  // 4-space-indented text is never code here and is intentionally left
  // unmasked, matching @mdx-js/mdx's own parsing.
  for (const line of source.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeFence) {
      fenceBuffer.push(line)
      if (fenceMatch && fenceMatch[1][0] === codeFence) {
        lines.push(stash(fenceBuffer.join('\n')))
        codeFence = null
        fenceBuffer = []
      }
      continue
    }
    if (fenceMatch) {
      codeFence = fenceMatch[1][0]
      fenceBuffer = [line]
      continue
    }
    lines.push(line.split(/(`[^`]*`)/).map((segment, index) => (
      index % 2 === 1 ? stash(segment) : segment
    )).join(''))
  }
  // An unterminated fence (malformed source) still must not be rewritten.
  if (fenceBuffer.length) lines.push(stash(fenceBuffer.join('\n')))

  return {
    masked: lines.join('\n'),
    unmask: (text) => text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => blocks[Number(index)]),
  }
}

/**
 * Apply a textual rename to the WHOLE body outside fenced/inline code (via
 * `maskCode`), so a match may span multiple lines.
 */
function replaceOutsideCode(body: string, transform: (whole: string) => string): string {
  const { masked, unmask } = maskCode(body)
  return unmask(transform(masked))
}

/**
 * Converts an HTML comment (`<!-- text -->`) to MDX's own comment syntax
 * (`{/* text *\/}`), skipping fenced/inline code. remark-mdx does not parse
 * `<!-- -->` at all — a real Markdown/Docusaurus source commonly has one
 * (`<!-- prettier-ignore -->` ahead of a snippet import is a common
 * Docusaurus pattern) and it otherwise throws "Unexpected character `!`"
 * wherever something needs a real MDX parse of the page — not just this
 * module's `normalizeMdx`, but `components.ts`'s independent component
 * analysis too, before that pass ever gets a chance to run.
 */
export function normalizeHtmlComments(body: string): string {
  return replaceOutsideCode(body, (whole) => whole.replace(/<!--([\s\S]*?)-->/g, (_match, comment: string) => `{/*${comment}*/}`))
}

/**
 * Rewrite Fern's callout intents to Thally's fixed callout tags without
 * touching fenced code. Delimiters are tracked with a stack so nested and
 * sibling callouts each close with the tag their own opening intent chose;
 * the stack order only holds up when both passes run over the whole body in
 * document order, which `replaceOutsideCode` provides.
 */
function normalizeFernCallouts(body: string): string {
  return replaceOutsideCode(body, (whole) => {
    const openTags: Array<string> = []
    return whole
      .replace(/<Callout\s+intent=(?:"([^"]*)"|'([^']*)')([^>]*?)(\/?)>/g, (_match, doubleQuoted: string, singleQuoted: string, rest: string, selfClose: string) => {
        const intent = (doubleQuoted ?? singleQuoted ?? '').toLowerCase()
        const tag = intent === 'warning'
          ? 'Warning'
          : intent === 'success' || intent === 'tip'
            ? 'Tip'
            : intent === 'error' || intent === 'danger' ? 'Error' : 'Note'
        if (!selfClose) openTags.push(tag)
        return `<${tag}${rest}${selfClose}>`
      })
      // Only rewrite closes paired with a Fern `<Callout intent="...">` we
      // actually opened; a bare Mintlify `<Callout>...</Callout>` (no
      // `intent`) never pushed a tag, so its closing tag must stay as-is.
      .replace(/<\/Callout>/g, (match) => openTags.length ? `</${openTags.pop()}>` : match)
  })
}

/**
 * Unwrap Fern's per-tab `<CodeBlock>` only while inside a `<CodeGroup>`
 * (renamed from Fern's `<CodeBlocks>` earlier in the pipeline). Mintlify also
 * ships a genuine, globally available `<CodeBlock>` component for
 * programmatic rendering inside custom React components — that usage never
 * nests inside a `<CodeGroup>`, so it survives untouched.
 */
function unwrapFernCodeBlockTabs(body: string): string {
  return replaceOutsideCode(body, (whole) => {
    let groupDepth = 0
    return whole.replace(/<CodeGroup\b[^>]*>|<\/CodeGroup>|<CodeBlock\b[^>]*>|<\/CodeBlock>/g, (match) => {
      if (match.startsWith('<CodeGroup')) {
        groupDepth++
        return match
      }
      if (match === '</CodeGroup>') {
        groupDepth = Math.max(0, groupDepth - 1)
        return match
      }
      return groupDepth > 0 ? '' : match
    })
  })
}

// TODO: a plain <pre>/<code> shim, not Thally's styled Pre/CodeGroup —
// upgrade to a registered `CodeBlock` MDX built-in (mirroring Code/CodeGroup)
// once the scaffold template ships one.
const STANDALONE_CODE_BLOCK_SHIM = [
  'export const CodeBlock = ({ children, filename, ...rest }) => (',
  '  <pre {...rest}>',
  '    {filename ? <div>{filename}</div> : null}',
  '    <code>{children}</code>',
  '  </pre>',
  ');',
].join('\n')

/** Extracts the source text of each top-level `export const X = (...) => (…|{…` body. */
function exportDeclarationBodies(body: string): Array<string> {
  const bodies: Array<string> = []
  const opener = /export const \w+ = [^\n]*=> ([({])/g
  for (const match of body.matchAll(opener)) {
    const open = match[1]
    const close = open === '(' ? ')' : '}'
    let depth = 1
    let i = (match.index ?? 0) + match[0].length
    while (i < body.length && depth > 0) {
      if (body[i] === open) depth++
      else if (body[i] === close) depth--
      i++
    }
    bodies.push(body.slice((match.index ?? 0) + match[0].length, i))
  }
  return bodies
}

/**
 * True when `export const NAME = ` (ending right at `sourceIndex`) assigns a
 * real function expression — `function` or an arrow function — rather than a
 * plain value whose initializer merely contains `=>` further in, the way
 * `list.map((x) => x)` does. Only a genuine function reference crosses the
 * server/client boundary as a prop; a value like `items` above does not.
 */
export function isFunctionInitializer(source: string, sourceIndex: number): boolean {
  let index = sourceIndex
  const skipSpace = () => { while (/\s/.test(source[index] ?? '')) index++ }
  // Keywords must end at a word boundary: `functionList`, `asyncMode`, and
  // `classNames` are ordinary identifiers, not function expressions.
  const keyword = (word: string) => new RegExp(`^${word}(?![\\w$])`).test(source.slice(index))
  skipSpace()
  if (keyword('async')) {
    index += 'async'.length
    skipSpace()
    // `async => x` is an arrow whose parameter is named `async`.
    if (source.startsWith('=>', index)) return true
  }
  if (keyword('function') || keyword('class')) return true
  if (source[index] === '(') {
    let depth = 0
    for (; index < source.length; index++) {
      if (source[index] === '(') depth++
      else if (source[index] === ')') {
        depth--
        if (depth === 0) {
          index++
          break
        }
      }
    }
    skipSpace()
    return source.startsWith('=>', index)
  }
  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(index))
  if (!identifier) return false
  index += identifier[0].length
  skipSpace()
  return source.startsWith('=>', index)
}

/**
 * Detects a page-authored function (`export const Name = () => ...`) passed
 * as a bare JSX prop value (`someProp={Name}`) elsewhere on the same page.
 * Next renders an MDX page as a Server Component by default; an extracted
 * interactive snippet it imports is `'use client'` (see `components.ts`).
 * Passing a plain function across that boundary as a prop throws at render
 * ("Functions cannot be passed directly to Client Components") even though
 * the MDX itself compiles cleanly — Mintlify's own renderer has no such
 * server/client split, so this content is valid there. Thally has no import
 * mechanism that moves the declaration into the client module instead, so
 * the page is reported and excluded rather than shipped broken.
 *
 * Two things keep this from over-firing: fenced/inline code (a doc example
 * showing this exact shape) never counts, via `maskCode`; and only a real
 * function initializer counts as "a function" — `export const items =
 * list.map((x) => x)` is a plain value, not one, even though its own
 * initializer happens to contain `=>`.
 */
export function hasClientBoundaryFunctionProp(body: string): boolean {
  const { masked } = maskCode(body)
  const declared = [...functionDeclaredNames(body)]
  return declared.some((name) => new RegExp(`\\w+=\\{${name}\\}`).test(masked))
}

/**
 * A page's top-level `export` identifiers that are actually functions — a
 * `function`/`async function` declaration, or an `export const NAME = `
 * whose initializer is a real function expression (see
 * `isFunctionInitializer`). Excludes plain values (`export const diagram =
 * 'graph TD'`), even when their initializer text happens to contain `=>`
 * further in (`export const items = list.map((x) => x)`). Callers that need
 * to know whether a prop value crosses the server/client boundary as a
 * function must check against this set, not every `export const` name —
 * confusing the two would exclude pages that merely pass a string or object
 * to a client component.
 */
export function functionDeclaredNames(body: string): Set<string> {
  const { masked } = maskCode(body)
  const names = new Set<string>()
  for (const match of masked.matchAll(/export const (\w+)\s*=\s*/g)) {
    if (isFunctionInitializer(masked, (match.index ?? 0) + match[0].length)) names.add(match[1])
  }
  // Function declarations (incl. `default`, `async`, generators) and classes:
  // a class is a constructor function and is just as unserializable.
  for (const match of masked.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+)(\w+)/g)) {
    names.add(match[1])
  }
  // One level of aliasing: `export const Alias = Demo` where `Demo` is one.
  for (const match of masked.matchAll(/^export const (\w+)\s*=\s*(\w+)\s*;?\s*$/gm)) {
    if (names.has(match[2])) names.add(match[1])
  }
  return names
}

/**
 * A page's own `export const` declarations sometimes reference a Mintlify
 * global built-in by bare JS identifier (e.g. `<CodeBlock>` or `<Icon>`
 * inside a custom render function) instead of through prose, where Thally's
 * MDX registry wires it in automatically via `_components`. A bare reference
 * with nothing importing or declaring it throws `ReferenceError` at render.
 * Provide it the same way the source page would have gotten it implicitly:
 * a real import where Thally ships an equivalent, otherwise a minimal
 * same-file shim (see `STANDALONE_CODE_BLOCK_SHIM`).
 */
function provideScopedGlobalReferences(body: string): string {
  const alreadyBound = (name: string): boolean => new RegExp(`\\b${name}\\s*[=:]|\\bimport\\s+.*\\b${name}\\b`).test(body)
  const referencedIn = exportDeclarationBodies(body).join('\n')

  let result = body
  if (/<Icon\b/.test(referencedIn) && !alreadyBound('Icon')) {
    result = `import { Icon } from '@/components/mdx/content-icon';\n\n${result}`
  }
  if (/<CodeBlock\b/.test(referencedIn) && !alreadyBound('CodeBlock')) {
    result = `${STANDALONE_CODE_BLOCK_SHIM}\n\n${result}`
  }
  return result
}

/**
 * Docusaurus authors a `<Tabs>` block's human labels once, in its own
 * `values={[{ label, value }, ...]}` prop, and each `<TabItem value="...">`
 * repeats only the machine `value`. Thally's `<Tab title="...">` has no
 * separate values table, so each tab's title must be resolved from the
 * parent's `values` entry (a `TabItem`'s own `label` still wins when given).
 * Docusaurus-only props that Thally's `<Tabs>` does not read are dropped so
 * they don't linger as dead JSX attributes on the migrated component.
 */
function normalizeDocusaurusTabs(body: string): string {
  return body.replace(/<Tabs\b([^>]*)>([\s\S]*?)<\/Tabs>/g, (_match, attributes: string, inner: string) => {
    const labelByValue = new Map<string, string>()
    const valuesSource = attributes.match(/\bvalues=\{(\[[\s\S]*?\])\s*\}/)?.[1]
    if (valuesSource) {
      for (const entry of valuesSource.matchAll(/\{([^{}]*)\}/g)) {
        const label = entry[1].match(/\blabel:\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
        const value = entry[1].match(/\bvalue:\s*(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
        if (value) labelByValue.set(value, label ?? value)
      }
    }
    const cleanedAttributes = attributes
      .replace(/\s*defaultValue=(?:\{[^}]*\}|"[^"]*"|'[^']*')/g, '')
      .replace(/\s*values=\{[\s\S]*?\]\s*\}/g, '')
      .replace(/\s*groupId=(?:"[^"]*"|'[^']*')/g, '')
      .replace(/\s*queryString(?:=(?:\{[^}]*\}|"[^"]*"|'[^']*'))?/g, '')
    const rewrittenInner = inner
      .replace(/<TabItem\b([^>]*)>/g, (_itemMatch, itemAttributes: string) => {
        const label = itemAttributes.match(/\blabel=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
        const value = itemAttributes.match(/\bvalue=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
        const title = label ?? (value && labelByValue.get(value)) ?? value ?? 'Tab'
        return `<Tab title="${title.replace(/"/g, '&quot;')}">`
      })
      .replace(/<\/TabItem>/g, '</Tab>')
    return `<Tabs${cleanedAttributes}>${rewrittenInner}</Tabs>`
  })
}

const TAB_FENCE_OPEN = /^(`{3,}|~{3,})(\S*)\s+tab\b(.*)$/

/**
 * `docusaurus-remark-plugin-tab-blocks` marks each fence in a tab group with
 * a `tab` meta keyword (```` ```js tab title="npm" ````). Thally has no
 * matching remark plugin, but its `<CodeGroup>` already reads the same
 * `title=` fence attribute for tab labels, so consecutive tab-marked fences
 * are wrapped in one and the now-meaningless `tab` keyword is dropped. Only
 * fences that opt in via that keyword are touched — this never fires
 * speculatively on an ordinary fence.
 */
function normalizeDocusaurusTabBlocks(body: string): string {
  const lines = body.split('\n')
  const output: Array<string> = []
  let index = 0
  while (index < lines.length) {
    const open = lines[index].match(TAB_FENCE_OPEN)
    if (!open) {
      output.push(lines[index])
      index++
      continue
    }
    const blocks: Array<Array<string>> = []
    while (index < lines.length) {
      const start = lines[index].match(TAB_FENCE_OPEN)
      if (!start) break
      const marker = start[1]
      const block = [`${start[1]}${start[2]}${start[3]}`]
      index++
      while (index < lines.length && lines[index].trim() !== marker) {
        block.push(lines[index])
        index++
      }
      block.push(lines[index] ?? marker)
      index++
      blocks.push(block)
      let lookahead = index
      while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead++
      if (!lines[lookahead] || !TAB_FENCE_OPEN.test(lines[lookahead])) break
      index = lookahead
    }
    if (blocks.length > 1) {
      output.push('<CodeGroup>', '')
      for (const block of blocks) output.push(...block, '')
      output.pop()
      output.push('</CodeGroup>')
    } else {
      output.push(...blocks[0])
    }
  }
  return output.join('\n')
}

/**
 * Split a CSS declaration list on top-level `;` only — a `;` inside
 * `url(...)` (a data URI commonly contains one) must not end the
 * declaration early.
 */
function splitCssDeclarations(value: string): Array<string> {
  const parts: Array<string> = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ';' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

/**
 * Convert a CSS property name to the key a JSX style object expects:
 * camelCase, vendor prefixes capitalized (`-webkit-transform` ->
 * `WebkitTransform`) except React's own `-ms-` quirk (`msTransform`, not
 * `MsTransform`), and a custom property (`--x`) left as a literal string key.
 */
function cssPropertyToJsKey(property: string): string {
  if (property.startsWith('--')) return JSON.stringify(property)
  const camel = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
  return camel.startsWith('Ms') ? camel.slice(0, 1).toLowerCase() + camel.slice(1) : camel
}

/**
 * Convert an HTML `style="..."` attribute's raw CSS text into the object
 * literal a JSX `style={{...}}` prop requires.
 *
 * TODO: `!important` cannot be expressed in a React style object at all
 * (there is no per-declaration escape hatch), so it is dropped rather than
 * left in a value string where it would do nothing; upgrade to a `!` layer
 * of inline `<style>` injection if a real page ever needs it.
 */
function cssTextToStyleObjectLiteral(cssText: string): string {
  const entries = splitCssDeclarations(cssText).flatMap((declaration) => {
    const colon = declaration.indexOf(':')
    if (colon === -1) return []
    const property = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).replace(/\s*!\s*important\s*$/i, '').trim()
    if (!property || !value || !/^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/.test(property)) return []
    return [`${cssPropertyToJsKey(property)}: ${JSON.stringify(value)}`]
  })
  return `{${entries.join(', ')}}`
}

/**
 * Rewrite a string `style="..."`/`style='...'` attribute on a lowercase
 * (intrinsic HTML) JSX element into `style={{...}}`. JSX (unlike HTML)
 * requires `style` to be a mapping from property to value; a raw string —
 * common in Markdown/MDX pasted from HTML, e.g. a copied DataFrame table —
 * throws at render instead of just being ignored, so this must run
 * unconditionally, not only for a known source platform. An already-correct
 * `style={...}` expression is untouched (the match requires a quote right
 * after `=`), as is any component tag (uppercase-first is never matched).
 */
function convertHtmlStyleAttributes(body: string): string {
  return body.replace(
    // The separator before `style=` must be `\s+`, not a single `\s`: a
    // multi-line tag indents its attributes, so more than one whitespace
    // character (a newline plus spaces) commonly precedes it.
    /<([a-z][a-zA-Z0-9]*)((?:\s+[^\s"'=<>/]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s+style=(["'])([\s\S]*?)\3((?:\s+[^\s"'=<>/]+(?:=(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g,
    (_match, tag: string, before: string, _quote: string, styleText: string, after: string, selfClose: string) => (
      `<${tag}${before} style={${cssTextToStyleObjectLiteral(styleText)}}${after}${selfClose ? ' /' : ''}>`
    ),
  )
}

/** Normalize only syntax Thally cannot render; supported source JSX stays intact. */
export function normalizeMdx(body: string, platform?: MigrationPlatform): string {
  // A caller that doesn't know the source platform (the URL crawler, when it
  // can't identify one) must not guess — applying every platform's textual
  // renames to a page of unknown origin corrupts one that happens to use the
  // same component name for something else, e.g. a Mintlify page's own
  // `<Success>` becoming `<Tip>`, a Fern-only alias. An omitted platform
  // therefore runs no platform-specific renames; a caller exercising one
  // must pass it explicitly.
  const runFern = platform === 'fern'
  const runMintlify = platform === 'mintlify'
  const runDocusaurus = platform === 'docusaurus'

  let rewritten = normalizeDocusaurusAdmonitions(runFern ? normalizeFernCallouts(body) : body)
  if (runDocusaurus) {
    // Docusaurus injects these theme components globally. Thally also
    // exposes its equivalents globally, so source-only imports must not survive.
    const withoutGlobalImports = rewritten
      .split('\n')
      .filter((line) => !isGlobalDocusaurusImport(line))
      .join('\n')
    rewritten = normalizeDocusaurusTabBlocks(normalizeDocusaurusTabs(withoutGlobalImports))
  }
  rewritten = replaceOutsideCode(rewritten, (segment) => {
    let result = convertHtmlStyleAttributes(segment)
      .replace(/<!--([\s\S]*?)-->/g, (_match, content: string) => `{/*${content}*/}`)
      .replace(/<Danger(\s[^>]*)?>/g, '<Error$1>')
      .replace(/<\/Danger>/g, '</Error>')
      .replace(/<Warn(\s[^>]*)?>/g, '<Warning$1>')
      .replace(/<\/Warn>/g, '</Warning>')
      .replace(/<Check(\s[^>]*)?>/g, '<Note$1>')
      .replace(/<\/Check>/g, '</Note>')
      .replace(/<Tree\.Folder/g, '<Folder')
      .replace(/<\/Tree\.Folder>/g, '</Folder>')
      .replace(/<Tree\.File/g, '<File')
      .replace(/<\/Tree\.File>/g, '</File>')
    if (runDocusaurus) {
      result = result
        // A TabItem outside any <Tabs>...</Tabs> pair (malformed source)
        // never reaches normalizeDocusaurusTabs' block match above; fall
        // back to its own label/value so it still renders as a Tab.
        .replace(/<TabItem\b([^>]*)>/g, (_match, attributes: string) => {
          const title = attributes.match(/\blabel=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
            ?? attributes.match(/\bvalue=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
            ?? 'Tab'
          return `<Tab title="${title.replace(/"/g, '&quot;')}">`
        })
        .replace(/<\/TabItem>/g, '</Tab>')
        .replace(/<Link\b([^>]*)\bto=(?:"([^"]*)"|'([^']*)')([^>]*)>/g, (_match, before: string, doubleQuoted: string, singleQuoted: string, after: string) => (
          `<a${before}href="${doubleQuoted ?? singleQuoted}"${after}>`
        ))
        .replace(/<\/Link>/g, '</a>')
        .replace(/<(?:DocCardList|TOCInline)\b[^>]*\/>/g, '')
    }
    if (runMintlify) {
      result = result
        // Mintlify documents `<FileTree>` as a plain alias of `<Tree>`; Thally
        // only registers the latter.
        .replace(/<FileTree(\s[^>]*)?>/g, '<Tree$1>')
        .replace(/<\/FileTree>/g, '</Tree>')
        // Mintlify's `<GitHub.Repo repo="owner/name" />` is the same repository
        // card Thally already registers as `<GitHub repo="owner/name" />`.
        .replace(/<GitHub\.Repo/g, '<GitHub')
        .replace(/<\/GitHub\.Repo>/g, '</GitHub>')
        // `<Column>` is an unstyled wrapper for arbitrary content inside
        // `<Columns>`; Thally's grid already treats any direct child as a
        // column, so a plain `<div>` (built into MDX, no registry entry
        // needed) matches.
        .replace(/<Column(\s[^>]*)?>/g, '<div$1>')
        .replace(/<\/Column>/g, '</div>')
    }
    if (runFern) {
      result = result
        // Fern-only wrappers with a direct Thally equivalent.
        .replace(/<CodeBlocks(\s[^>]*)?>/g, '<CodeGroup$1>')
        .replace(/<\/CodeBlocks>/g, '</CodeGroup>')
        .replace(/<ParameterField\b/g, '<ParamField')
        .replace(/<\/ParameterField>/g, '</ParamField>')
        .replace(/<Cards(\s[^>]*)?>/g, '<CardGroup$1>')
        .replace(/<\/Cards>/g, '</CardGroup>')
        .replace(/<Success(\s[^>]*)?>/g, '<Tip$1>')
        .replace(/<\/Success>/g, '</Tip>')
        .replace(/<Launch(\s[^>]*)?>/g, '<Note$1>')
        .replace(/<\/Launch>/g, '</Note>')
        // Fern's <Files> wraps <File>/<Folder> nodes Thally already renders
        // directly (also reached via the Docusaurus <Tree.Folder> rename above).
        .replace(/<Files(\s[^>]*)?>\n?/g, '')
        .replace(/<\/Files>/g, '')
    }
    return result
  })
  if (runFern) rewritten = unwrapFernCodeBlockTabs(rewritten)
  return provideScopedGlobalReferences(rewritten)
}

/** Parse source Markdown or MDX into the canonical page representation. */
export function parseMarkdownPage(input: {
  id: string
  navigationId?: string
  locale?: string
  raw: string
  source: string
  /** Gates platform-specific textual renames in `normalizeMdx`; omitted runs them all. */
  platform?: MigrationPlatform
  /** Resolve platform-specific routes from the already-parsed frontmatter. */
  resolveIdentity?: (
    frontmatter: Record<string, unknown>,
    fallback: MarkdownPageIdentity,
  ) => MarkdownPageIdentity
}): MigrationPage | null {
  const parsed = parseFrontmatter(input.raw)
  const fallbackIdentity: MarkdownPageIdentity = {
    id: input.id,
    navigationId: input.navigationId ?? input.id,
    ...(input.locale ? { locale: input.locale } : {}),
  }
  const identity = input.resolveIdentity?.(parsed.data, fallbackIdentity) ?? fallbackIdentity
  const body = normalizeMdx(parsed.content, input.platform).trim()
  const keywords = Array.isArray(parsed.data.keywords)
    ? parsed.data.keywords.filter((value): value is string => typeof value === 'string')
    : []
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
    ? parsed.data.title.trim()
    : titleFromId(identity.navigationId)
  const navTitle = typeof parsed.data.sidebarTitle === 'string' && parsed.data.sidebarTitle.trim()
    ? parsed.data.sidebarTitle.trim()
    : typeof parsed.data.navTitle === 'string' && parsed.data.navTitle.trim()
      ? parsed.data.navTitle.trim()
      : undefined
  const badge = typeof parsed.data.tag === 'string' && parsed.data.tag.trim()
    ? parsed.data.tag.trim()
    : typeof parsed.data.badge === 'string' && parsed.data.badge.trim()
      ? parsed.data.badge.trim()
      : undefined
  const sourceMode = typeof parsed.data.mode === 'string' ? parsed.data.mode : undefined
  // Mintlify's frame mode and Thally's wide mode both retain the sidebar while
  // removing the on-page table of contents. Other shared modes map directly.
  const mode = sourceMode === 'frame'
    ? 'wide'
    : ['default', 'wide', 'custom', 'center', 'home'].includes(sourceMode ?? '')
      ? sourceMode as MigrationPage['mode']
      : undefined
  const description = typeof parsed.data.description === 'string' && parsed.data.description.trim()
    ? parsed.data.description.trim()
    : firstParagraph(body)
  return {
    id: identity.id,
    navigationId: identity.navigationId,
    locale: identity.locale,
    title,
    navTitle,
    description,
    badge,
    keywords,
    mode,
    hidden: parsed.data.hidden === true ? true : undefined,
    noindex: parsed.data.noindex === true || parsed.data.noindex === 'true' ? true : undefined,
    openapi: typeof parsed.data.openapi === 'string' ? parsed.data.openapi.trim() : undefined,
    body,
    source: input.source,
  }
}
