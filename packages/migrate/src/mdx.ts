/** Markdown/MDX normalization that preserves every component Thally supports. */

import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

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

const FERN_UNSUPPORTED_COMPONENTS = [
  'EndpointRequestSnippet', 'EndpointResponseSnippet', 'EndpointExample',
  'Schema', 'Button', 'Aside', 'Markdown', 'RequestExample', 'ResponseExample',
]

/** Fern-only components Thally does not render; callers warn once per tag. */
export function detectUnsupportedFernComponents(body: string): Array<string> {
  return FERN_UNSUPPORTED_COMPONENTS.filter((name) => new RegExp(`<${name}(?:\\s|/?>)`).test(body))
}

const JS_LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined'])

/**
 * Fern's own MDX renderer tolerates a bare `{word}` in prose as literal text
 * (e.g. `"connection to {vendor} failed"`); Thally's MDX pipeline evaluates
 * `{...}` as a JS expression and throws `ReferenceError` when the identifier
 * isn't defined. Escape only unambiguous prose braces: a single bare word,
 * never inside a fenced/inline code span or a JSX attribute expression
 * (`prop={word}`, where it is genuinely code).
 */
export function escapeFernLiteralBraces(body: string): string {
  let codeFence: string | null = null
  return body.split('\n').map((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!codeFence) codeFence = fence[1][0]
      else if (fence[1][0] === codeFence) codeFence = null
      return line
    }
    if (codeFence) return line
    let result = ''
    let inInlineCode = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '`') {
        inInlineCode = !inInlineCode
        result += char
        continue
      }
      // Skip a `{` the source already escaped (`\{`) or that is part of a
      // literal `{{mustache}}`-style double brace; only a lone, unescaped
      // single-brace word is the ambiguous case Thally's MDX would choke on.
      if (!inInlineCode && char === '{' && line[i - 1] !== '=' && line[i - 1] !== '\\' && line[i - 1] !== '{') {
        // Also covers a bare dotted reference (`{http.Server}`), a common way
        // Fern prose spells a parameter's type without it being real code.
        const match = /^\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}(?!\})/.exec(line.slice(i))
        if (match && !JS_LITERAL_KEYWORDS.has(match[1])) {
          result += `\\{${match[1]}\\}`
          i += match[0].length - 1
          continue
        }
      }
      result += char
    }
    return result
  }).join('\n')
}

/**
 * Walk `body` line by line, tracking fenced code blocks, and hand every line
 * outside a fence to `visitLine` together with its fence state. A textual
 * rename applied to raw source (rather than a parsed AST) must never fire
 * inside a fenced code block or an inline `code span` — that content documents
 * syntax rather than using it (e.g. prose reading "`<Tree>` and `<FileTree>`
 * are aliases" must not become "`<Tree>` and `<Tree>`"). Every platform's
 * line-based renamer in this module goes through this one fence tracker
 * instead of re-implementing it.
 */
function mapOutsideCodeFences(body: string, visitLine: (line: string) => string): string {
  let codeFence: string | null = null
  return body.split('\n').map((line) => {
    const codeMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeMatch) {
      if (!codeFence) codeFence = codeMatch[1][0]
      else if (codeMatch[1][0] === codeFence) codeFence = null
      return line
    }
    if (codeFence) return line
    return visitLine(line)
  }).join('\n')
}

/**
 * Apply a textual rename only to prose: outside fenced code blocks (via
 * `mapOutsideCodeFences`) and outside inline `code spans` within a surviving
 * line, where the same characters are documentation about syntax, not syntax.
 */
function replaceOutsideCode(body: string, transform: (segment: string) => string): string {
  return mapOutsideCodeFences(body, (line) => (
    line.split(/(`[^`]*`)/).map((segment, index) => (index % 2 === 0 ? transform(segment) : segment)).join('')
  ))
}

/**
 * Rewrite Fern's callout intents to Thally's fixed callout tags without
 * touching fenced code. Delimiters are tracked with a stack so nested and
 * sibling callouts each close with the tag their own opening intent chose.
 */
function normalizeFernCallouts(body: string): string {
  const openTags: Array<string> = []
  return mapOutsideCodeFences(body, (line) => line
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
    .replace(/<\/Callout>/g, (match) => openTags.length ? `</${openTags.pop()}>` : match))
}

/**
 * Unwrap Fern's per-tab `<CodeBlock>` only while inside a `<CodeGroup>`
 * (renamed from Fern's `<CodeBlocks>` earlier in the pipeline). Mintlify also
 * ships a genuine, globally available `<CodeBlock>` component for
 * programmatic rendering inside custom React components — that usage never
 * nests inside a `<CodeGroup>`, so it survives untouched.
 */
function unwrapFernCodeBlockTabs(body: string): string {
  let groupDepth = 0
  return mapOutsideCodeFences(body, (line) => {
    if (/<CodeGroup\b/.test(line)) groupDepth++
    const result = groupDepth > 0
      ? line.replace(/<CodeBlock\b[^>]*>\n?/g, '').replace(/<\/CodeBlock>/g, '')
      : line
    if (/<\/CodeGroup>/.test(line)) groupDepth = Math.max(0, groupDepth - 1)
    return result
  })
}

// ponytail: a plain <pre>/<code> shim, not Thally's styled Pre/CodeGroup —
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
 * Detects a page-authored function (`export const Name = ... =>`) passed as
 * a bare JSX prop value (`someProp={Name}`) elsewhere on the same page. Next
 * renders an MDX page as a Server Component by default; an extracted
 * interactive snippet it imports is `'use client'` (see `components.ts`).
 * Passing a plain function across that boundary as a prop throws at render
 * ("Functions cannot be passed directly to Client Components") even though
 * the MDX itself compiles cleanly — Mintlify's own renderer has no such
 * server/client split, so this content is valid there. Thally has no import
 * mechanism that moves the declaration into the client module instead, so
 * the page is reported and excluded rather than shipped broken.
 */
export function hasClientBoundaryFunctionProp(body: string): boolean {
  const declared = [...body.matchAll(/export const (\w+) = [^\n]*=>/g)].map((match) => match[1])
  return declared.some((name) => new RegExp(`\\w+=\\{${name}\\}`).test(body))
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

/** Normalize only syntax Thally cannot render; supported source JSX stays intact. */
export function normalizeMdx(body: string, platform?: MigrationPlatform): string {
  // A caller that already knows the source platform (a real migration) must
  // not let another platform's textual renames leak into this content — e.g.
  // a Mintlify page's own `<Success>` component must not become `<Tip>`,
  // which is a Fern-only alias. Direct unit tests exercise these renames
  // without picking a platform, so an omitted platform keeps every rename
  // available, as before.
  const runFern = platform === undefined || platform === 'fern'
  const runMintlify = platform === undefined || platform === 'mintlify'
  const runDocusaurus = platform === undefined || platform === 'docusaurus'

  let rewritten = normalizeDocusaurusAdmonitions(runFern ? normalizeFernCallouts(body) : body)
  if (runDocusaurus) {
    rewritten = normalizeDocusaurusTabBlocks(normalizeDocusaurusTabs(rewritten))
      // Docusaurus injects these theme components globally. Thally also
      // exposes its equivalents globally, so source-only imports must not survive.
      .replace(/^import\s+(?:Tabs|TabItem|Link|DocCardList|TOCInline)\s+from\s+['"]@(?:theme|docusaurus)\/[^'"]+['"]\s*;?\s*$/gm, '')
  }
  rewritten = replaceOutsideCode(rewritten, (segment) => {
    let result = segment
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
