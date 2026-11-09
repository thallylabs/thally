/** Markdown/MDX normalization that preserves every component Thally supports. */

import type * as acorn from 'acorn'
// @ts-expect-error eslint-scope ships no types; the one function used here is typed where it is called.
import { analyze } from 'eslint-scope'
import { posix } from 'node:path'
import { compileSync } from '@mdx-js/mdx'
import type { CompileOptions } from '@mdx-js/mdx'
import { nameToEmoji } from 'gemoji'
import remarkGfm from 'remark-gfm'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { isThallyBuiltinComponent } from './builtin-components.js'
import { pageScopeNames, unresolvedExpressionNames } from './inline-extraction.js'
import { playgroundDisplay } from './mintlify-extras.js'
import { parseFrontmatter } from './frontmatter.js'
import { SOURCE_PAGE_ATTRIBUTE } from './source-styles.js'
import { normalizeMintlifyCodeFences } from './fence-meta.js'
import type { MigrationPage, MigrationPlatform } from './types.js'

/**
 * How every check of whether a page compiles reads it. The runtime compiles with remark-gfm
 * (`src/mdx/remark.ts`), under which a bare URL is an autolink that swallows its braces, so a
 * page compiles here exactly when it compiles there.
 */
export const MDX_COMPILE_OPTIONS: CompileOptions = { outputFormat: 'program', remarkPlugins: [remarkGfm] }

export interface MarkdownPageIdentity {
  id: string
  navigationId: string
  locale?: string
}

/** Fern's `availability` (beta, alpha, deprecated, ...) as the label Thally shows beside the page; a generally available page has none. */
export function fernAvailabilityBadge(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const words = value.trim().toLowerCase().replace(/[-_]+/g, ' ')
  if (!words || ['generally available', 'ga', 'stable'].includes(words)) return undefined
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`.slice(0, 40)
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

const descriptionParser = unified().use(remarkParse).use(remarkGfm).use(remarkMdx)

/** `elements`, when given, leaves out every JSX element and what it holds, and is set once one is met. */
function plainText(node: DescriptionNode & { name?: string | null }, elements?: { found: boolean }, skipNames?: ReadonlySet<string>): string {
  if (skipNames && (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') && skipNames.has(String(node.name).toLowerCase())) return ''
  if (elements && (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement')) {
    elements.found = true
    return ''
  }
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
  if (node.type === 'image') return node.alt ?? ''
  if (node.type === 'break') return ' '
  return (node.children ?? []).map((child) => plainText(child, elements, skipNames)).join('')
}

function headingText(content: string, definitions?: ReadonlyMap<string, string>, elements?: { found: boolean }): string {
  const references = [...content.matchAll(/\[([^\]\n]+)\]/g)]
    .map((match) => definitions?.get(match[1].trim().replace(/\s+/g, ' ').toLowerCase()) ?? '').join('\n')
  try { return plainText(descriptionParser.parse(`# ${content}\n\n${references}`) as DescriptionNode, elements).trim() }
  catch { return content }
}

/** Read visible inline text without including JSX attributes or Markdown syntax. */
export function mdxVisibleText(content: string, definitions?: ReadonlyMap<string, string>): string {
  return headingText(content, definitions)
}

/**
 * The text the renderer builds a heading's id from: the heading's own text, without its inline components and what they hold
 * (`Setup <Badge>Pro</Badge>` reads "Setup"). Undefined when the heading has no inline component, or when nothing an id is made of
 * is left, so the caller reads the heading's whole text as it always did.
 */
export function mdxTextWithoutInlineElements(content: string, definitions?: ReadonlyMap<string, string>): string | undefined {
  if (!/<[A-Za-z]/.test(content)) return undefined
  const elements = { found: false }
  const text = headingText(content, definitions, elements)
  return elements.found && /[\p{L}\p{M}\p{N}]/u.test(text) ? text : undefined
}

/** Elements that hold form controls, scripts or styles: their text is interface chrome, never description copy. */
const NON_PROSE_ELEMENTS = new Set(['form', 'label', 'input', 'select', 'textarea', 'button', 'script', 'style', 'noscript', 'template'])

function firstParagraph(content: string): string {
  function findParagraph(node: DescriptionNode & { name?: string | null }): string {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && NON_PROSE_ELEMENTS.has(String(node.name).toLowerCase())) return ''
    if (node.type === 'paragraph') {
      const value = plainText(node, undefined, NON_PROSE_ELEMENTS).replace(/\s+/g, ' ').trim()
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

interface PositionedNode extends DescriptionNode {
  position?: { start: { offset?: number }; end: { offset?: number } }
}

// Plain CommonMark: a description is not MDX, so `<` and `{` in it must not fail the parse, and a bare address is not a link.
const linkParser = unified().use(remarkParse)

/**
 * `text` with each Markdown link (`[text](url)`, `<https://...>`) replaced by the source of its text, so inline code, emphasis and
 * everything else stay as written. A link is read the way Markdown reads it, so one inside a code span, an escaped bracket, an image
 * and a bracket pair with no `(url)` are not links. Unchanged when it has none.
 */
function withoutMarkdownLinks(text: string): string {
  const links: Array<{ start: number; end: number; textStart: number; textEnd: number }> = []
  const collect = (node: PositionedNode): void => {
    if (node.type === 'link') {
      const first = (node.children?.[0] as PositionedNode | undefined)?.position?.start.offset
      const last = (node.children?.at(-1) as PositionedNode | undefined)?.position?.end.offset
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined) links.push({ start, end, textStart: first ?? start, textEnd: last ?? start })
      return
    }
    for (const child of node.children ?? []) collect(child)
  }
  collect(linkParser.parse(text) as PositionedNode)
  return links.reduceRight((result, link) => result.slice(0, link.start) + result.slice(link.textStart, link.textEnd) + result.slice(link.end), text)
}

function docusaurusAdmonitionTag(kind: string): 'Error' | 'Info' | 'Note' | 'Warning' {
  if (kind === 'danger') return 'Error'
  if (kind === 'info') return 'Info'
  if (kind === 'caution' || kind === 'warning') return 'Warning'
  return 'Note'
}

/**
 * Scans the opening tag of `<name` at `start` to its closing `>`, skipping
 * quoted values and `{expressions}` (strings and any brace depth) so a `>` inside
 * them does not end the tag. The scan also stops at the next `<name` opener, so
 * a run of unterminated openers is scanned once in total, not once per opener.
 * `attributes` is what was scanned; `next` advances callers past that span.
 */
export function scanJsxOpeningTag(source: string, start: number, name: string): { attributes: string; end: number | null; next: number } {
  const opener = `<${name}`
  let quote: string | null = null
  let depth = 0
  let braceQuote: string | null = null
  let lineComment = false
  let blockComment = false
  const attributesStart = start + opener.length
  for (let index = attributesStart; index < source.length; index++) {
    const char = source[index]
    if (char === '<' && !quote && !braceQuote && depth === 0 && !lineComment && !blockComment
      && source.startsWith(opener, index) && !/[\w$.-]/.test(source[index + opener.length] ?? '')) {
      return { attributes: source.slice(attributesStart, index), end: null, next: index }
    }
    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false
    } else if (blockComment) {
      if (char === '*' && source[index + 1] === '/') { blockComment = false; index++ }
    } else if (braceQuote) {
      if (char === '\\') index++
      else if (char === braceQuote) braceQuote = null
    } else if (depth > 0) {
      if (char === '/' && source[index + 1] === '/') { lineComment = true; index++ }
      else if (char === '/' && source[index + 1] === '*') { blockComment = true; index++ }
      else if (char === '"' || char === "'" || char === '`') braceQuote = char
      else if (char === '{') depth++
      else if (char === '}') depth--
    } else if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '{') depth++
    else if (char === '>') return { attributes: source.slice(attributesStart, index), end: index, next: index + 1 }
  }
  return { attributes: source.slice(attributesStart), end: null, next: source.length }
}

/**
 * `<Admonition type="tip" title="X">` is the JSX spelling of a colon-fence
 * admonition and maps to the same callouts.
 */
export function normalizeDocusaurusAdmonitionTags(segment: string): string {
  const open: Array<string> = []
  const marker = /<\/Admonition>|<Admonition(?![\w$.-])/g
  let output = ''
  let cursor = 0
  for (let match = marker.exec(segment); match; match = marker.exec(segment)) {
    if (match[0] === '</Admonition>') {
      output += `${segment.slice(cursor, match.index)}\n</${open.pop() ?? 'Note'}>`
      cursor = marker.lastIndex
      continue
    }
    const tag = scanJsxOpeningTag(segment, match.index, 'Admonition')
    marker.lastIndex = tag.next
    if (tag.end === null) continue
    const type = tag.attributes.match(/\btype=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)?.toLowerCase() ?? 'note'
    const title = tag.attributes.match(/\btitle=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)?.trim()
    const callout = docusaurusAdmonitionTag(type)
    open.push(callout)
    output += `${segment.slice(cursor, match.index)}${title ? `<${callout}>\n**${title}**\n` : `<${callout}>\n`}`
    cursor = tag.end + 1
    marker.lastIndex = cursor
  }
  return output + segment.slice(cursor)
}

/** `<Link to=...>` becomes `<a href=...>`; a tag that never closes is left as written. */
export function normalizeDocusaurusLinkTags(segment: string): string {
  const marker = /<Link(?![\w$.-])/g
  let output = ''
  let cursor = 0
  for (let match = marker.exec(segment); match; match = marker.exec(segment)) {
    const tag = scanJsxOpeningTag(segment, match.index, 'Link')
    marker.lastIndex = tag.next
    if (tag.end === null) continue
    output += `${segment.slice(cursor, match.index)}<a${tag.attributes.replace(/(^|\s)to=/, '$1href=')}>`
    cursor = tag.end + 1
    marker.lastIndex = cursor
  }
  return (output + segment.slice(cursor)).replace(/<\/Link>/g, '</a>')
}

/**
 * Thally has no light/dark image component, so `<ThemedImage sources={{ light, dark }}>`
 * keeps its light image (a literal path, or `useBaseUrl('...')` of one).
 */
function normalizeDocusaurusThemedImages(segment: string): string {
  return segment.replace(/<ThemedImage\b([^<]*?)\/>/g, (original: string, attributes: string) => {
    const light = attributes.match(/\blight\s*:\s*(?:useBaseUrl\(\s*)?(?:"([^"]+)"|'([^']+)')/)?.slice(1).find(Boolean)
    if (!light) return original
    const alt = attributes.match(/\balt=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find((value) => value !== undefined)
    return `<img src="${light.replace(/"/g, '&quot;')}"${alt === undefined ? '' : ` alt="${alt.replace(/"/g, '&quot;')}"`} />`
  })
}

/**
 * Convert Docusaurus' colon-fence admonitions without interpreting code-fence
 * contents. Longer delimiters support nested admonitions in the same way as
 * the source renderer.
 */
function normalizeDocusaurusAdmonitions(body: string): string {
  const lines = body.split('\n')
  const openAdmonitions: Array<{ delimiter: string; tag: string; openedAt: number }> = []
  const headingLines: Array<number> = []
  let codeFence: string | null = null

  const output = lines.map((line, index) => {
    const codeMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (codeMatch) {
      if (!codeFence) codeFence = codeMatch[1]
      else if (codeMatch[1][0] === codeFence[0] && codeMatch[1].length >= codeFence.length
        && /^\s*$/.test(line.slice(codeMatch[0].length))) codeFence = null
      return line
    }
    if (codeFence) return line
    if (/^#{1,6}\s/.test(line)) headingLines.push(index)

    const opening = line.match(/^\s*(:{3,})(note|tip|info|warning|caution|danger)(?:\[([^\]]+)\]|\s+(.+))?\s*$/i)
    if (opening) {
      const tag = docusaurusAdmonitionTag(opening[2].toLowerCase())
      openAdmonitions.push({ delimiter: opening[1], tag, openedAt: index })
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
  })
  // Docusaurus tolerates an unterminated admonition in some archived docs.
  // Close it before the next top-level heading (or at EOF) so an otherwise
  // complete page remains importable instead of being discarded by MDX.
  const closingByLine = new Map<number, Array<string>>()
  for (const open of openAdmonitions.reverse()) {
    const at = headingLines.find((line) => line > open.openedAt) ?? output.length
    closingByLine.set(at, [...(closingByLine.get(at) ?? []), `</${open.tag}>`])
  }
  for (const [at, closing] of [...closingByLine].sort(([left], [right]) => right - left)) output.splice(at, 0, ...closing)
  return output.join('\n')
}

/**
 * Docusaurus' `mdx-code-block` fence is an escape hatch for live MDX syntax,
 * often used to open a JSX element around ordinary Markdown and code blocks.
 * Remove only the special fence itself; its contents must pass through the
 * same component and link normalization as the rest of the page.
 */
function unwrapDocusaurusMdxCodeBlocks(body: string): string {
  const output: Array<string> = []
  let fence: string | undefined
  let isMdxCodeBlock = false
  for (const line of body.split('\n')) {
    const opening = !fence && line.match(/^ {0,3}(`{3,}|~{3,})mdx-code-block\s*$/)
    if (opening) {
      fence = opening[1]
      isMdxCodeBlock = true
      continue
    }
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/)
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) {
        if (!isMdxCodeBlock) output.push(line)
        fence = undefined
        isMdxCodeBlock = false
        continue
      }
      // These blocks may be Docusaurus' only declaration of a theme or
      // npm component used later on the page. Opening just the JSX would
      // promote an unresolved import into Thally's server build, so leave
      // the entire page's source-specific fences intact.
      if (isMdxCodeBlock && /^\s*(?:import|export)\b/.test(line)) return body
      output.push(line)
      continue
    }
    const ordinaryFence = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (ordinaryFence) {
      fence = ordinaryFence[1]
      isMdxCodeBlock = false
    }
    output.push(line)
  }
  // An unmatched source fence remains visible to the MDX compiler, which
  // reports the malformed page rather than silently deleting its contents.
  return isMdxCodeBlock ? body : output.join('\n')
}

// Any HTML5 id: non-empty, no whitespace. `"` `'` `<` `>` `&` and backticks
// would break the generated `id="..."` attribute and `{` `}` would reopen an MDX
// expression. A single character class, so it cannot backtrack.
const HTML_ID = /^[^\s"'<>`{}&]+$/u

/**
 * Keep explicit heading anchors without leaving `{#id}` as an MDX expression.
 * An id that is not a valid HTML id is stripped (and reported through `warn`)
 * so the page still compiles. Frontmatter is left untouched.
 */
export function normalizeExplicitHeadingIds(
  raw: string,
  warn?: (message: string) => void,
  options: { headingMarkers?: boolean; keepIdComments?: boolean } = {},
): string {
  const { front, body } = splitFrontmatterBlock(raw)
  return front + replaceOutsideCode(body, (segment) => segment.split('\n').map((line) => {
    if (!/^[ \t]{0,3}#{1,6}[ \t]+/.test(line)) return line
    const trimmed = line.trimEnd()
    // Check suffixes from the end instead of matching unbounded whitespace
    // against unbounded heading text; that combination backtracks on long
    // headings with no valid anchor.
    if (trimmed.endsWith('}')) {
      const marker = trimmed.lastIndexOf(' {#')
      if (marker >= 0) {
        const id = trimmed.slice(marker + 3, -1)
        const heading = trimmed.slice(0, marker).trimEnd()
        // Braces in the "id" mean this is prose like `{#if} blocks {x}`, not one anchor.
        if (/[{}]/.test(id)) return line
        // Mintlify keeps the authored id on the heading itself. The renderer
        // reads `{/* #id */}`, so the id may hold any character React can put
        // in an attribute; only whitespace and a comment terminator are unsafe.
        const usable = options.headingMarkers ? id && !/\s/.test(id) && !id.includes('*/') : HTML_ID.test(id)
        if (usable && options.headingMarkers) return `${heading} ${headingIdMarker(id)}`
        // Numeric starts are valid here; Mintlify uses ids such as 429-responses.
        if (usable) return `<a id="${id}"></a>\n${heading}`
        warn?.(`Heading anchor {#${id}} ${options.headingMarkers ? 'contains whitespace or "*/"' : 'is not a valid HTML id'} and was removed from "${heading.replace(/^\s*#+\s*/, '')}".`)
        return heading
      }
    }
    // Docusaurus' heading plugin also accepts a trailing MDX comment.
    // (Mintlify output uses that same comment as its marker, so it stays.)
    if (!options.headingMarkers && !options.keepIdComments && trimmed.endsWith('*/}')) {
      const marker = trimmed.lastIndexOf(' {/*')
      if (marker >= 0) {
        const comment = trimmed.slice(marker + 4, -3).trim()
        const id = comment.startsWith('#') ? comment.slice(1) : ''
        if (HTML_ID.test(id)) {
          return `<a id="${id}"></a>\n${trimmed.slice(0, marker).trimEnd()}`
        }
      }
    }
    return line
  }).join('\n'))
}

/** The trailing comment that gives a heading an explicit id; read by the renderer, `thally check` and the content parser. */
function headingIdMarker(id: string): string {
  return `{/* #${id} */}`
}

/**
 * Fern's custom heading anchor, `## Title [#custom-id]`: the suffix leaves the visible text and the id stays on the heading,
 * in the marker form the renderer reads. Only a trailing `[#id]` on a heading line counts, and the id is a plain anchor name.
 */
export function normalizeFernHeadingIds(raw: string): string {
  const { front, body } = splitFrontmatterBlock(raw)
  return front + replaceOutsideCode(body, (segment) => segment.split('\n').map((line) => {
    if (!/^[ \t]{0,3}#{1,6}[ \t]+/.test(line)) return line
    const trimmed = line.trimEnd()
    const marker = trimmed.endsWith(']') ? trimmed.lastIndexOf('[#') : -1
    if (marker <= 0) return line
    const id = trimmed.slice(marker + 2, -1)
    const heading = trimmed.slice(0, marker).trimEnd()
    return /^[\w.:-]+$/.test(id) && /[^\s#]/.test(heading.replace(/^[ \t]{0,3}#{1,6}/, '')) ? `${heading} ${headingIdMarker(id)}` : line
  }).join('\n'))
}

/** Characters Mintlify keeps in an id besides letters, marks and digits; the ones around which it also places a dash. */
const HEADING_ID_WORD = /[\p{L}\p{M}\p{N}_+&/@%=<>|\u2019\u201c\u201d\u2014\u2013\u2192\u2026]/u

/**
 * The id Mintlify gives a heading with no explicit `{#id}`, from its rendered
 * text. Derived from the live ids of two Mintlify sites: whitespace and `-`
 * become one dash, as does a `.` before a word, a `(` between a word and a
 * word or `{` (`start(body`), and a `)` glued to what follows it (`()`+`:`).
 * `{`, `:`, `,` and `"` drop out but end a run of dashes, so `(`, `{`, space gives
 * two, as does `), ` (`lower(x), upper(x)` is `lower-x--upper-x`). `+ & / _ @ % = < > |`,
 * typographic quotes and dashes, arrows and the ellipsis are kept, other
 * punctuation and emoji are dropped, and repeats are numbered `-2`, `-3`, ...
 * by the renderer. Read from other sites' ids: a `.` before a `,` makes a dash
 * (`e.g., x` is `e-g--x`), and `(s)` after a word is the plural (`domain(s)` is
 * `domains`). A dash a space or `-` makes stays at the end of the id, after
 * what writes nothing (`loadSkill({ name })` is `loadskill--name-`); one a `.`,
 * `(` or `)` made does not (`dispatchEnvelope().` is `dispatchenvelope`).
 */
export function mintlifyHeadingSlug(text: string): string {
  const chars = [...text.replace(/[\u200b*]/g, '').replace(/(?<=[\p{L}\p{M}\p{N}_])\(s\)(?![\p{L}\p{M}\p{N}_])/gu, 's').normalize('NFC').trim().toLowerCase()]
  const isWord = (char: string | undefined): boolean => char !== undefined && HEADING_ID_WORD.test(char)
  let id = ''
  let afterDash = false
  let endsWithDash = false
  // The id ends in a dash only a `.`, `(` or `)` made, and nothing has been written since.
  let softDash = false
  chars.forEach((char, index) => {
    const before = chars[index - 1]
    const after = chars[index + 1]
    endsWithDash = false
    if (isWord(char)) {
      id += char
      afterDash = false
      softDash = false
    } else if (
      /[\s-]/.test(char)
      || (char === '.' && (isWord(after) || after === ','))
      || (char === '(' && isWord(before) && (isWord(after) || after === '{'))
      || (char === ')' && after !== undefined && !/\s/.test(after))
    ) {
      softDash = /[\s-]/.test(char) ? false : (id !== '' && !afterDash) || softDash
      if (id && !afterDash) id += '-'
      afterDash = true
      endsWithDash = true
    } else if (char === '{' || char === ':' || char === '"' || char === ',') {
      afterDash = false
    }
  })
  return endsWithDash || softDash ? id.replace(/-$/, '') : id
}

/** Thally's own heading slug (`slugify` in `@thallylabs/core`), used to tell which headings already match. */
function thallyHeadingSlug(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '')
}

/**
 * A link's `](destination)` with one level of parentheses inside it, in the URL or the quoted title (Docusaurus headings end in
 * `[\u200b](#id "Direct link to Interchain Security Module (ISM)")`). The alternatives never overlap, so it cannot backtrack badly.
 */
const LINK_DESTINATION = String.raw`\]\((?:[^()]|\([^()]*\))*\)`
/** What typesetting leaves alone: code, tags and link destinations (`split` keeps these at the odd indexes). */
const TYPESET_PROTECTED = new RegExp(`(\`[^\`]*\`|<[^>]*>|${LINK_DESTINATION})`)

/**
 * Mintlify typesets straight quotes in heading text, and its ids keep the typographic characters. A heading that opens with a straight
 * double quote and does not end with one gets a closing quote first (2 of 2 such headings on a live site); one quoted from end to end
 * keeps its opening quote (another live site).
 */
function typesetQuotes(text: string): string {
  const opensClosed = text.startsWith('"') && !text.trimEnd().endsWith('"')
  return text.split(TYPESET_PROTECTED).map((part, index) => {
    if (index % 2) return part
    return part
      // The leading quote of such a heading is left straight here, so the next step closes it.
      .replace(/(^|[\s([{\u2014\u2013])"/g, (match, before: string) => (opensClosed && index === 0 && before === '' ? match : `${before}\u201c`))
      .replace(/"/g, '\u201d')
      .replace(/(^|[\s([{\u2014\u2013\u201c])'(?=\S)(?!&lt;|<)/g, '$1\u2018').replace(/'/g, '\u2019')
  }).join('')
}

/** Mintlify typesets `...` as an ellipsis in a heading's text, not in its code, and its id keeps it (`f(x, ...)` is `f-x-…`). */
function typesetEllipses(text: string): string {
  return text.split(TYPESET_PROTECTED).map((part, index) => (index % 2 ? part : part.replace(/\.{3}/g, '\u2026'))).join('')
}

const LINK_HOLDING_CODE = new RegExp(`(\`[^\`]*\`)|!?\\[((?:\`[^\`]*\`|[^\\]\`])*)${LINK_DESTINATION}`, 'g')
const PLAIN_LINK = new RegExp(`!?\\[([^\\]]*)${LINK_DESTINATION}`, 'g')

/** Visible text of a heading's inline Markdown. */
function plainHeadingText(source: string): string {
  // A link's text can hold code (`[`Scrape`](/n8n)`), and the split below would cut the link in three and leave its target in the text,
  // so a link that holds code spans goes first. A code span is skipped whole: link syntax inside it is text.
  const unlinked = !source.includes('`') ? source
    : source.replace(LINK_HOLDING_CODE, (_match: string, code?: string, text = '') => code ?? text)
  // What a code span holds is text, whatever it looks like: no comment, link, tag or emphasis is read inside it (`Option<T>` keeps its `<T>`).
  return unlinked.split(/(`[^`]*`)/).map((part, index) => (index % 2 ? part.slice(1, -1) : part
    // An authored MDX comment is not rendered, so Mintlify's id never sees it.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(PLAIN_LINK, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/(?<!\\)(\*\*|__|~~|\*)/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\\([\\`*_{}[\]()#+.!&<>|~-])/g, '$1'))).join('')
}

interface IdClaimNode extends DescriptionNode {
  depth?: number
  attributes?: Array<{ type: string; name?: string; value?: unknown }>
  children?: Array<IdClaimNode>
  position?: { start: { line: number } }
}

/** A string an attribute holds, written as `"x"` or as a static expression (`{"x"}`, `{'x'}`, `{`x`}`); undefined for anything computed. */
function staticAttributeString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const expression = (value as { value?: unknown } | null)?.value
  if (typeof expression !== 'string') return undefined
  return expression.match(/^\s*(?:"([^"\\]*)"|'([^'\\]*)'|`((?:[^`\\$]|\$(?!\{))*)`)\s*$/)?.slice(1).find((part) => part !== undefined)
}

/**
 * Who could own which id on a page, read from the page as the renderer parses it (headings at any depth, the `title` and `id`
 * attributes of any component, ids written in a heading), not from its lines: a line inside a code block, a heading in a blockquote
 * and an attribute over several lines all read as what they are. Ids are compared without a trailing `-N`, which numbering adds.
 * `free(id, line)` is true when the heading at `line` is a heading of the page and nothing but that heading's own text could own `id`
 * (an anchor or title on the same line is something else); a page that does not parse has no free id.
 */
function pageIdClaims(body: string): { free: (id: string, line: number) => boolean } {
  let tree: IdClaimNode
  try { tree = descriptionParser.parse(body) as IdClaimNode } catch { return { free: () => false } }
  const owners = new Map<string, { owner: string; shared: boolean }>()
  const headingLines = new Set<number>()
  let claims = 0
  const root = (id: string): string => id.toLowerCase().replace(/-\d+$/, '')
  const claim = (owner: string, ...ids: Array<string>): void => {
    for (const id of ids) {
      const key = root(id)
      const held = owners.get(key)
      if (!key) continue
      if (!held) owners.set(key, { owner, shared: false })
      else if (held.owner !== owner) held.shared = true
    }
  }
  const visit = (node: IdClaimNode): void => {
    const line = node.position?.start.line ?? 0
    if (node.type === 'heading' && (node.depth ?? 0) >= 2) {
      headingLines.add(line)
      const text = typesetQuotes(plainText(node))
      claim(`heading ${line}`, mintlifyHeadingSlug(text), thallyHeadingSlug(text), thallyHeadingSlug(plainText(node, { found: false })))
      for (const child of node.children ?? []) {
        const authored = child.type === 'mdxTextExpression' ? child.value?.match(/^\s*\/\*\s*#(\S+?)\s*\*\/\s*$/)?.[1] : undefined
        if (authored) claim(`claim ${claims++}`, authored)
      }
    } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      for (const { type, name, value } of node.attributes ?? []) {
        const text = type === 'mdxJsxAttribute' ? staticAttributeString(value) : undefined
        if (text === undefined) continue
        if (name === 'id') claim(`claim ${claims++}`, text)
        else if (name === 'title') claim(`claim ${claims++}`, mintlifyHeadingSlug(text), thallyHeadingSlug(text))
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return {
    free: (id, line) => {
      const held = owners.get(root(id))
      return headingLines.has(line) && (!held || (held.owner === `heading ${line}` && !held.shared))
    },
  }
}

/**
 * Give each Mintlify heading the id Mintlify serves, so in-page and cross-page
 * `#anchor` links from the source still land. Only headings whose id differs
 * from Thally's own slug get a marker, which leaves every other anchor alone.
 * Straight quotes in heading text are typeset as Mintlify does.
 *
 * The renderer builds an id from a heading's own text, without its inline components and what they hold, which Mintlify's id keeps
 * (`Setup <Badge>Pro</Badge>`: `setup` against `setup-pro`). Such a heading is marked too, unless something else on the page
 * could own that id: a marker reserves its id for the whole page, so it would move the other holder's anchor.
 */
export function markMintlifyHeadings(body: string): string {
  let fence: string | undefined
  let claims: ReturnType<typeof pageIdClaims> | undefined
  return body.split('\n').map((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length
        && /^\s*$/.test(line.slice(marker[0].length))) fence = undefined
      return line
    }
    if (fence) return line
    const heading = line.match(/^( {0,3}#{2,6}[ \t]+)(.+?)(?:[ \t]+#+)?[ \t]*$/)
    if (!heading) return line
    // An explicit `{#id}` is already a marker and wins over the computed id.
    const explicit = heading[2].match(/^(.*?)([ \t]*\{\/\*[ \t]*#\S+[ \t]*\*\/\})$/)
    const source = typesetQuotes(explicit ? explicit[1] : heading[2])
    if (explicit) return `${heading[1]}${source}${explicit[2]}`
    const text = plainHeadingText(source)
    const id = mintlifyHeadingSlug(plainHeadingText(typesetEllipses(source)))
    let marked = id !== thallyHeadingSlug(text)
    if (id && !marked) {
      const visible = mdxTextWithoutInlineElements(source)
      if (visible !== undefined && id !== thallyHeadingSlug(visible)) marked = (claims ??= pageIdClaims(body)).free(id, index + 1)
    }
    return `${heading[1]}${source}${id && marked ? ` ${headingIdMarker(id)}` : ''}`
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
function removeGlobalDocusaurusImports(body: string): string {
  return replaceOutsideCode(body, (segment) => segment.replace(
    /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])(@(?:theme|docusaurus)\/[^'"]+)\2\s*;?/g,
    (statement: string, component: string) => GLOBAL_DOCUSARUS_COMPONENTS.has(component) ? '' : statement,
  ))
}

const JS_LITERAL_KEYWORDS = new Set(['true', 'false', 'null', 'undefined'])
// A leading identifier segment (`x` in `x.y.z`) may be any valid JS/Unicode
// identifier, not just ASCII — `{café}`, `{$var}` are both real bare
// references a page's own ESM could bind, and Fern's literal-brace prose
// (the thing this whole pass is trying to leave alone) never happens to
// look like one, so escaping stays conservative either way.
const BARE_IDENTIFIER_PATH = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*(?:\.[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)*$/u
// Double-mustache templating syntax (`{{now}}`, `{{customer}}`) is common in
// prose copied from other platforms (Liquid/Handlebars-style variable
// interpolation). MDX parses the outer `{...}` as an expression container and
// the inner `{now}` as a JS object-literal shorthand property, so the node's
// value looks like `{now}` — a single bare identifier wrapped in its own
// braces — never a real JSX prop (which appears inside an attribute, not
// standalone body/flow text). Matching this shape lets the same "leave a
// $ref alone unless we can hint an undeclared reference" caution apply to
// double-brace template text as it already does to single-brace text.
const BARE_OBJECT_SHORTHAND = /^\{\s*([\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)\s*\}$/u
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
  depth?: number
  value?: string
  name?: string | null
  data?: { estree?: acorn.Program | null }
  children?: Array<MdxOffsetNode>
  position?: { start: { offset?: number }; end: { offset?: number } }
}

/** An ESTree node as scope analysis sees it: JSX nodes are not in acorn's own types. */
interface EstreeNode {
  type: string
  start: number
  end: number
  name?: string
  shorthand?: boolean
  computed?: boolean
  object?: unknown
  property?: { type: string; name?: string; value?: unknown }
  operator?: string
  left?: EstreeNode
  right?: EstreeNode
  argument?: EstreeNode
  test?: EstreeNode
  expression?: EstreeNode
  consequent?: EstreeNode
  alternate?: EstreeNode
  value?: unknown
  regex?: unknown
  bigint?: unknown
}

/** The ESTree nodes directly under `node`. */
function estreeChildren(node: EstreeNode): Array<EstreeNode> {
  return Object.values(node).flatMap((child) => Array.isArray(child) ? child : [child])
    .filter((entry): entry is EstreeNode => Boolean(entry) && typeof entry === 'object' && typeof entry.type === 'string')
}

/** What a fully static expression comes to: a primitive (`undefined` for a prop the call left out), or the JSX element or fragment it selects. */
type StaticValue = string | number | boolean | null | undefined | { jsx: EstreeNode }

interface SourceEdit { start: number; end: number; value: string }

/** `text` starts at `offset` in the source the edits are positioned in. */
function applyEdits(text: string, edits: ReadonlyArray<SourceEdit>, offset = 0): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((out, edit) => out.slice(0, edit.start - offset) + edit.value + out.slice(edit.end - offset), text)
}

/**
 * What `node` comes to when nothing in it is left to run, or undefined when anything is. Static means a string, number,
 * boolean or null literal, a bound prop (`literals`, by the span it stood on) and `=== !== == != && || ! ?:` over those. JSX is
 * carried as the value an operator selects and never looked into. Both sides of an operator must be static even when one would
 * decide the result alone: a part that cannot be read is not guessed at.
 */
function foldStatic(node: EstreeNode, literals: ReadonlyMap<string, string | undefined>): { value: StaticValue } | undefined {
  const primitive = (child: EstreeNode | undefined): { value: string | number | boolean | null | undefined } | undefined => {
    const folded = child && foldStatic(child, literals)
    return folded && (typeof folded.value !== 'object' || folded.value === null) ? { value: folded.value } : undefined
  }
  const truthy = (value: StaticValue): boolean => typeof value === 'object' && value !== null ? true : Boolean(value)
  switch (node.type) {
    case 'Literal': {
      const value = node.value
      return !node.regex && !node.bigint && (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        ? { value: value as string | number | boolean | null } : undefined
    }
    case 'Identifier':
    case 'MemberExpression': {
      const span = `${node.start}:${node.end}`
      return literals.has(span) ? { value: literals.get(span) } : undefined
    }
    case 'JSXElement':
    case 'JSXFragment':
      return { value: { jsx: node } }
    case 'UnaryExpression': {
      const argument = node.operator === '!' ? primitive(node.argument) : undefined
      return argument && { value: !argument.value }
    }
    case 'BinaryExpression': {
      const [left, right] = [primitive(node.left), primitive(node.right)]
      if (!left || !right) return undefined
      switch (node.operator) {
        case '===': return { value: left.value === right.value }
        case '!==': return { value: left.value !== right.value }
        case '==': return { value: left.value == right.value }
        case '!=': return { value: left.value != right.value }
        default: return undefined
      }
    }
    case 'LogicalExpression': {
      const [left, right] = [node.left && foldStatic(node.left, literals), node.right && foldStatic(node.right, literals)]
      if (!left || !right || (node.operator !== '&&' && node.operator !== '||')) return undefined
      return truthy(left.value) === (node.operator === '&&') ? right : left
    }
    case 'ConditionalExpression': {
      const [test, consequent, alternate] = [node.test, node.consequent, node.alternate].map((child) => child && foldStatic(child, literals))
      return test && consequent && alternate ? (truthy(test.value) ? consequent : alternate) : undefined
    }
    default:
      return undefined
  }
}

/** A string that stays plain text when written as Markdown: no marker, link, entity, tag or brace in it. */
const PLAIN_TEXT = /^\p{L}(?:[\p{L}\p{N} ,.;'?%$=+-]*[\p{L}\p{N}.])?$/u

/**
 * Bind static partial invocation props inside expressions, preserving literals and code examples.
 * A snippet reads its props as variables (`{mode === "x" && ...}`) or as `props.mode`; both become
 * the literal value. A prop binds only where scope analysis finds the reference free: it resolves
 * to no declaration of the expression (labels, `var` hoisting, parameter defaults, class blocks,
 * catch clauses and shadowing are all the analyzer's), and is not a name the snippet declares at the
 * top of its own module (`export const mode = ...`, a function, a class, an import). `props` is a
 * name like any other: `props.mode` binds only where `props` is free. An object key, a member name
 * and a class member name are not references, so they are left alone too.
 *
 * An expression the binding leaves with nothing to run (only literals, bound props, `=== !== == != && || ! ?:` and JSX)
 * is decided here, because the Thally runtime reads literals only and would render nothing for it: it becomes the JSX
 * branch it selects as MDX content, plain text, or nothing. Anything else in it, and any expression the binding did not
 * touch, stays as written.
 *
 * A lone `{name}` (a whole expression of one name, in text or as an attribute value) follows the same
 * rules; in text it becomes the value itself in a Markdown snippet and `{"value"}` in a JSX one, and
 * `{children}` always becomes the children as written, inside an expression as well. Text no
 * expression covers (inline code, a link destination) has its `{name}` replaced as it always was,
 * except inside a fenced code block.
 *
 * `unset` names the props the snippet declares and the call leaves out. They are `undefined` where
 * they are free, as in the component, so `{imgDark || img}` is decided and `{model && ...}` leaves nothing.
 */
export function bindSnippetProps(body: string, properties: ReadonlyMap<string, string>, unset: ReadonlySet<string> = new Set()): string {
  if ((properties.size === 0 && unset.size === 0) || (!body.includes('props') && ![...properties.keys(), ...unset].some((name) => body.includes(name)))) return body
  const isJsx = /<[A-Za-z][A-Za-z0-9]*/.test(body)
  let tree: unknown
  try { tree = descriptionParser.parse(body) } catch { tree = undefined }
  const edits: Array<SourceEdit> = []
  /** Where the snippet's expressions are: the text between is not code, and is bound by name. */
  const covered: Array<[number, number]> = []
  // What the snippet declares at the top of its own module is not a free variable anywhere in it.
  const moduleNames = new Set<string>()
  const collectModuleNames = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as MdxOffsetNode
    if (node.type === 'mdxjsEsm') collectEsmBindings(node, moduleNames)
    node.children?.forEach(collectModuleNames)
  }
  collectModuleNames(tree)
  /** Bind the props `program` reads without declaring them. A page's ESM binds only `props.name`: its own names are its own. */
  const bindFreeReferences = (program: acorn.Program, variables: boolean, literals: Map<string, string | undefined>): void => {
    const parents = new Map<unknown, EstreeNode>()
    const link = (node: EstreeNode): void => {
      for (const child of estreeChildren(node)) { parents.set(child, node); link(child) }
    }
    link(program as unknown as EstreeNode)
    // The references that resolve to no declaration anywhere in the program. `ecmaVersion` is a number: anything else is read as ES5, which has no block scope.
    const free: Array<{ identifier: acorn.Identifier }> = analyze(program, { ecmaVersion: 2022, sourceType: 'module' }).globalScope.through
    for (const { identifier } of free) {
      const { name, start, end } = identifier
      if (moduleNames.has(name)) continue
      const parent = parents.get(identifier)
      if (name === 'props' && parent?.type === 'MemberExpression' && parent.object === identifier) {
        const key = !parent.computed && parent.property?.type === 'Identifier' ? parent.property.name
          : parent.computed && parent.property?.type === 'Literal' && typeof parent.property.value === 'string' ? parent.property.value : undefined
        const replacement = key === undefined ? undefined : properties.get(key)
        if (replacement !== undefined && body.slice(parent.start, parent.end).startsWith('props')) {
          edits.push({ start: parent.start, end: parent.end, value: JSON.stringify(replacement) })
          literals.set(`${parent.start}:${parent.end}`, replacement)
          continue
        }
      }
      const bound = properties.get(name)
      if (variables && bound === undefined && unset.has(name)) {
        // `{ prop }` keeps its key; every other reference is replaced where it stands.
        if (parent?.type === 'Property' && parent.shorthand) edits.push({ start: parent.start, end: parent.end, value: `${name}: undefined` })
        else {
          edits.push({ start, end, value: 'undefined' })
          literals.set(`${start}:${end}`, undefined)
        }
        continue
      }
      if (!variables || bound === undefined) continue
      if (name !== 'children') {
        // `{ mode }` keeps its key; every other reference is replaced where it stands.
        if (parent?.type === 'Property' && parent.shorthand) edits.push({ start: parent.start, end: parent.end, value: `${name}: ${JSON.stringify(bound)}` })
        else {
          edits.push({ start, end, value: JSON.stringify(bound) })
          literals.set(`${start}:${end}`, bound)
        }
      } else if (parent?.type === 'JSXExpressionContainer' && ['JSXElement', 'JSXFragment'].includes(parents.get(parent)?.type ?? '')) {
        // The children a call gives a snippet are text of the page, as a lone `{children}` has always been.
        edits.push({ start: parent.start, end: parent.end, value: bound })
      }
    }
  }
  /**
   * The edit that puts `text` where the block expression `[start, end]` stood. That expression was a block of its own, so the lines it now
   * touches are set off from `text` by a blank line, as it set them off: left as it is, a text or a JSX element would join the paragraph
   * above or below it. A blank line stays as it is, and what leaves nothing leaves a blank line already. A blank line the edit makes or
   * leaves is empty, or is a quote's `>` alone: the indent of the container it is in is not needed on it, and would only trail.
   */
  const asBlock = (text: string, start: number, end: number): SourceEdit => {
    const above = body.slice(0, start).split('\n')
    const prefix = above.pop() ?? ''
    const touches = (line: string | undefined): boolean => line !== undefined && /[^\s>]/.test(line)
    const eol = body.includes('\r\n') ? '\r\n' : '\n'
    // The blank line of the container the expression is in: a quote's `>`, a list item's indent, in the page's own line ending.
    const blank = `${eol}${prefix.replace(/[^ \t>]/g, ' ').trimEnd()}`
    const alone = /^[ \t>]*$/.test(prefix)
    const before = text !== '' && alone && touches(above.pop())
    // The line the expression stood on is a blank line when it leaves nothing, and the blank line above the text when `before`: its indent
    // is part of the edit, so that it can go, and `before` puts it back on the line that takes the text.
    const indent = alone && (before || text === '') ? prefix.length - prefix.trimEnd().length : 0
    return {
      start: start - indent,
      end,
      value: text && `${before ? `${eol}${prefix}` : ''}${text}${touches(body.slice(end).split('\n', 2)[1]) ? blank : ''}`,
    }
  }
  /**
   * `jsx` as MDX content, bound. An expression in it that the binding made static (a child or an attribute, as in the page itself)
   * is decided in turn, and one that still has something to run, or that the page wrote static itself, stays as bound.
   */
  const keepJsx = (jsx: EstreeNode, bound: ReadonlyArray<SourceEdit>, literals: ReadonlyMap<string, string | undefined>): string => {
    const folds: Array<SourceEdit> = []
    const within = (edit: SourceEdit, [from, to]: [number, number]): boolean => edit.start >= from && edit.end <= to
    const walk = (node: EstreeNode, inAttribute: boolean): void => {
      if (node.type !== 'JSXExpressionContainer') {
        for (const child of estreeChildren(node)) walk(child, node.type === 'JSXAttribute')
        return
      }
      // On a line of its own, as `asBlock` reads it: after a quote's `>` or an indent, and before a line ending of either kind.
      const alone = /(?:^|\n)[ \t>]*$/.test(body.slice(0, node.start)) && /^[ \t]*\r?(?:\n|$)/.test(body.slice(node.end))
      // A lone `{name}` is bound where it stands, as it is outside this JSX: it is not a condition.
      const fold = node.expression && node.expression.type !== 'Identifier' && bound.some((edit) => within(edit, [node.start, node.end]))
        ? foldExpression(node.expression, bound, literals, [node.start, node.end], inAttribute, alone && !inAttribute) : undefined
      if (fold) folds.push(fold)
    }
    walk(jsx, false)
    return applyEdits(body.slice(jsx.start, jsx.end), [...bound.filter((edit) => within(edit, [jsx.start, jsx.end]) && !folds.some((fold) => within(edit, [fold.start, fold.end]))), ...folds], jsx.start)
  }
  /**
   * The edit that puts the value of `expression`, whose props are bound, where it stood at `[start, end]`, or undefined when
   * anything in it is still left to run. A text expression becomes the JSX it selects as MDX content, plain text, or nothing; an
   * attribute's expression becomes a literal and is left alone when it selects JSX. A `flow` expression stays a block.
   */
  const foldExpression = (expression: EstreeNode, bound: ReadonlyArray<SourceEdit>, literals: ReadonlyMap<string, string | undefined>, [start, end]: [number, number], inAttribute: boolean, flow: boolean): SourceEdit | undefined => {
    const folded = foldStatic(expression, literals)
    if (!folded) return undefined
    const { value } = folded
    const place = (text: string): SourceEdit => flow ? asBlock(text, start, end) : { start, end, value: text }
    if (typeof value === 'object' && value !== null) return inAttribute ? undefined : place(keepJsx(value.jsx, bound, literals))
    if (inAttribute) return { start, end, value: `{${value === undefined ? 'undefined' : JSON.stringify(value)}}` }
    if (typeof value === 'boolean' || value === null || value === undefined || value === '') return place('')
    return place(typeof value === 'string' && PLAIN_TEXT.test(value) ? value : `{${JSON.stringify(value)}}`)
  }
  const foldBound = (program: acorn.Program, bound: ReadonlyArray<SourceEdit>, literals: ReadonlyMap<string, string | undefined>, span: [number, number], inAttribute: boolean, flow: boolean): SourceEdit | undefined => {
    const [statement] = program.body
    return program.body.length === 1 && statement.type === 'ExpressionStatement'
      ? foldExpression(statement.expression as unknown as EstreeNode, bound, literals, span, inAttribute, flow) : undefined
  }
  /** `span` is where an attribute's value expression sits, which the value node itself does not say. */
  const visit = (value: unknown, span?: [number, number]): void => {
    if (!value || typeof value !== 'object') return
    const node = value as MdxOffsetNode & { attributes?: Array<{ value?: unknown; position?: MdxOffsetNode['position'] }> }
    const program = node.data?.estree
    if (program) {
      const start = span?.[0] ?? node.position?.start.offset
      const end = span?.[1] ?? node.position?.end.offset
      if (start !== undefined && end !== undefined) covered.push([start, end])
      const [statement] = program.body
      const lone = node.type !== 'mdxjsEsm' && program.body.length === 1 && statement.type === 'ExpressionStatement' && statement.expression.type === 'Identifier'
        ? statement.expression : undefined
      if (lone) {
        const bound = moduleNames.has(lone.name) ? undefined : properties.get(lone.name)
        const missing = bound === undefined && !moduleNames.has(lone.name) && unset.has(lone.name)
        if (bound === undefined && !missing) {
          // Not a prop of this call, or the snippet's own name: it stays an expression.
        } else if (span || (isJsx && lone.name !== 'children')) edits.push({ start: lone.start, end: lone.end, value: missing ? 'undefined' : JSON.stringify(bound) })
        else if (start !== undefined && end !== undefined) edits.push(node.type === 'mdxFlowExpression' ? asBlock(bound ?? '', start, end) : { start, end, value: bound ?? '' })
      } else {
        const first = edits.length
        const literals = new Map<string, string | undefined>()
        bindFreeReferences(program, node.type !== 'mdxjsEsm', literals)
        // An expression the binding has made static is its value; one that still has something to run stays as bound.
        const folded = node.type !== 'mdxjsEsm' && edits.length > first && start !== undefined && end !== undefined
          ? foldBound(program, edits.slice(first), literals, span ?? [start, end], Boolean(span), node.type === 'mdxFlowExpression') : undefined
        if (folded) edits.splice(first, edits.length - first, folded)
      }
    }
    for (const attribute of node.attributes ?? []) {
      const from = attribute.position?.start.offset
      const to = attribute.position?.end.offset
      const brace = from === undefined ? -1 : body.indexOf('{', from)
      visit(attribute.value, to !== undefined && brace >= 0 && brace < to ? [brace, to] : undefined)
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  let fence = ''
  let lineStart = 0
  for (const line of body.split('\n')) {
    const start = lineStart
    lineStart += line.length + 1
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*?)\r?$/)
    if (marker) {
      // A fence closes on the same character, at least as long, with nothing after it: a shorter one or one with an info string is code.
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = ''
      continue
    }
    if (fence) continue
    for (const match of line.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      const at = start + match.index
      const bound = properties.get(match[1])
      if (bound === undefined || covered.some(([from, to]) => from <= at && at < to)) continue
      // Preserve MDX expression syntax: a literal replacement inside JSX would turn `<a href={url}>` into invalid `href=https://...`.
      edits.push({ start: at, end: at + match[0].length, value: match[1] === 'children' || !isJsx ? bound : `{${JSON.stringify(bound)}}` })
    }
  }
  return foldConstantTemplates(applyEdits(body, edits))
}

/** The string a template literal comes to when every `${}` in it is a string literal, or undefined when any is not. */
function constantTemplate(node: EstreeNode | undefined): string | undefined {
  if (node?.type !== 'TemplateLiteral') return undefined
  const { quasis, expressions } = node as unknown as { quasis: Array<{ value: { cooked: string | null } }>; expressions: Array<EstreeNode> }
  let text = ''
  for (const [index, quasi] of quasis.entries()) {
    if (quasi.value.cooked === null) return undefined
    text += quasi.value.cooked
    const expression = expressions[index]
    if (expression === undefined) continue
    if (expression.type !== 'Literal' || typeof expression.value !== 'string') return undefined
    text += expression.value
  }
  return text
}

/**
 * Write an attribute given as a template literal of string literals (`src={`/a/${"b"}.svg`}`, which inlining a component leaves
 * behind) as the plain string it is: `src="/a/b.svg"`. A template that reads a variable stays as it is.
 */
export function foldConstantTemplates(body: string): string {
  if (!body.includes('`')) return body
  let tree: MdxOffsetNode
  try { tree = descriptionParser.parse(body) as MdxOffsetNode } catch { return body }
  const edits: Array<SourceEdit> = []
  const attribute = (name: string, text: string, start: number, end: number): void => {
    edits.push({ start, end, value: /^[^"&<>{}\\\r\n]*$/.test(text) ? `${name}="${text}"` : `${name}={${JSON.stringify(text)}}` })
  }
  const walkEstree = (node: EstreeNode): void => {
    const attr = node as unknown as { name?: { type: string; name?: string }; value?: EstreeNode }
    if (node.type === 'JSXAttribute' && attr.name?.type === 'JSXIdentifier' && attr.value?.type === 'JSXExpressionContainer') {
      const text = constantTemplate(attr.value.expression)
      if (text !== undefined) attribute(attr.name.name ?? '', text, node.start, node.end)
    }
    for (const child of estreeChildren(node)) walkEstree(child)
  }
  const walk = (node: MdxOffsetNode): void => {
    const attributes = (node as { attributes?: Array<{ type: string; name?: string; value?: { data?: { estree?: acorn.Program | null } } | string | null; position?: MdxOffsetNode['position'] }> }).attributes
    for (const item of attributes ?? []) {
      const estree = typeof item.value === 'object' && item.value ? item.value.data?.estree : undefined
      const expression = (estree?.body[0] as unknown as EstreeNode | undefined)?.expression
      const text = item.type === 'mdxJsxAttribute' && item.name ? constantTemplate(expression) : undefined
      const start = item.position?.start.offset
      const end = item.position?.end.offset
      if (text !== undefined && start !== undefined && end !== undefined) attribute(item.name!, text, start, end)
    }
    if (node.data?.estree) walkEstree(node.data.estree as unknown as EstreeNode)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return edits.length > 0 ? applyEdits(body, edits) : body
}

/** Use a page's leading H1 as its title without rendering it twice. */
function leadingPageHeading(body: string): { title: string; start: number; end: number } | undefined {
  if (!/^ {0,3}(?:#(?:[ \t]|$)|=+[ \t\r]*$)/m.test(body)) return undefined
  try {
    const root = descriptionParser.parse(body) as MdxOffsetNode
    const first = root.children?.find((node) => node.type !== 'mdxjsEsm' && node.type !== 'html'
      && !(node.type === 'mdxFlowExpression' && node.data?.estree?.body.length === 0))
    if (first?.type !== 'heading' || first.depth !== 1) return undefined
    const text = (node: MdxOffsetNode): string => node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression'
      ? ''
      : node.value ?? (node.children ?? []).map(text).join('')
    const title = text(first).replace(/\s+/g, ' ').trim()
    const start = first.position?.start.offset
    const end = first.position?.end.offset
    return title && start !== undefined && end !== undefined ? { title, start, end } : undefined
  } catch {
    return undefined
  }
}

/** Recheck after component fallbacks, which can expose a page's leading H1. */
export function resolvePageDisplayHeading(page: Pick<MigrationPage, 'title' | 'body' | 'headingTitle'>, platform?: MigrationPlatform): void {
  const heading = leadingPageHeading(page.body)
  if (!heading || (heading.title !== page.title && platform !== 'docusaurus')) return
  if (heading.title !== page.title) page.headingTitle = heading.title
  page.body = `${page.body.slice(0, heading.start)}${page.body.slice(heading.end)}`.trim()
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
/**
 * Mask, within a single line, every backtick code span and every JSX/HTML
 * tag (open, close, or self-closing — including its attribute values) so
 * `protectMathBlocks`'s inline `$...$` scan below can never mistake a `$`
 * inside either for a math delimiter, and a matched math span can never
 * straddle a masked region (the placeholder has no `$` in it, so the regex
 * simply can't span across one). A JSX tag never spans a `$...$` scan's own
 * line here because `protectMathBlocks` processes text line by line; a tag
 * split across lines is already opaque to it for other reasons.
 */
function maskInlineSpansForMath(rawLine: string): { masked: string; unmask: (text: string) => string } {
  // NUL is never valid in MDX; strip it so it cannot collide with the
  // placeholder markers (same rule as `maskCode`).
  const line = rawLine.replace(/\u0000/g, '')
  const blocks: Array<string> = []
  const stash = (text: string): string => {
    blocks.push(text)
    return `\u0000${blocks.length - 1}\u0000`
  }
  const codeMasked = line.split(/(`[^`]*`)/).map((segment, index) => (
    index % 2 === 1 ? stash(segment) : segment
  )).join('')
  const tagMasked = codeMasked.replace(/<\/?[a-zA-Z][^<>]*>/g, stash)
  // Also mask a JSX expression container (`{...}`), one level of nesting
  // deep, so `$` inside one (e.g. a prop value built from a template
  // literal that isn't itself backtick-quoted) is never read as a math
  // delimiter. Two passes handle one level of `{...{...}...}` nesting; a
  // line-local regex can't balance further than that, which is fine here —
  // anything left over simply isn't masked, the conservative default. A
  // `{` immediately after `$` is deliberately left unmasked: that is a
  // template-literal interpolation (`${...}`), not a JSX container, and the
  // caller's own `$(?!{)` guard needs to see the literal `{` to reject it.
  const masked = [tagMasked, tagMasked].reduce((text) => text.replace(/(?<!\$)\{[^{}]*\}/g, stash), tagMasked)
  // A tag or `{...}` container is stashed after the code spans inside it, so
  // its block still holds their placeholders: unmask each block too. A single
  // pass left `\u00000\u0000` in the page, which `maskCode` later stripped to a
  // bare `0` (a prop like `code: \`x$y\`` silently became `code: 0`).
  const unmask = (text: string): string => text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => unmask(blocks[Number(index)]))
  return { masked, unmask }
}

/**
 * Whether `content` (the real, unmasked text between a matched pair of
 * inline `$...$`) looks like actual TeX rather than two unrelated dollar
 * amounts or a stray currency symbol: a backslash command (`\times`,
 * `\text{...}`), `^`/`_` (super/subscript), or a brace group. A bare
 * variable-style token with no space and no digit (`$S$`, `$x$`) is also
 * accepted without any of those — KaTeX/Pandoc's own convention for a
 * single-symbol inline reference, and the shape of the paradex-docs repro.
 */
const TEX_SIGNAL = /\\[a-zA-Z]|[\^_{]/
function hasTexSignal(content: string): boolean {
  return TEX_SIGNAL.test(content) || (!/\s/.test(content) && !/\d/.test(content))
}

/**
 * Net count of `{`, `(`, `[` minus their closers on `line` — a lazy,
 * string/comment-unaware bracket count (not a real JS parse) used only to
 * tell when a multi-line `import`/`export` ESM statement has closed. Real
 * component source rarely has an unbalanced bracket inside a string on the
 * same line as an ESM statement's own delimiters, and this is a heuristic
 * for skipping a scan, not a correctness-critical parse.
 * TODO: raw character count, ignores strings/comments; a real AST pass
 * would be exact, add one if this heuristic misfires on real content.
 */
function bracketDelta(line: string): number {
  let delta = 0
  for (const ch of line) {
    if (ch === '{' || ch === '(' || ch === '[') delta += 1
    else if (ch === '}' || ch === ')' || ch === ']') delta -= 1
  }
  return delta
}

/** Trimmed line opens a top-level `import`/`export` ESM statement (Docusaurus/MDX allow one anywhere a block can start, not just at the top of the file). */
const ESM_OPEN = /^(?:import|export)\b/

/** Keep TeX as a literal JSX string so braces and backslashes survive MDX parsing. */
function latexElement(source: string, block = false): string {
  return `<Latex${block ? ' block' : ''}>{${JSON.stringify(source)}}</Latex>`
}

export function protectMathBlocks(raw: string): { body: string; converted: boolean; guardTriggered?: boolean } {
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
  // Depth of an open `import`/`export` ESM statement (counted in
  // `bracketDelta`): while positive, every line belongs to page-authored
  // JS/JSX source (e.g. an inlined snippet's `export const X = () => {...}`
  // component body), not markdown/math prose, and is copied through
  // untouched — never scanned for `$`, so a template literal's `${expr}`
  // inside it can never be misread as a math delimiter.
  let esmDepth = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (mathBlockDelimiter) {
      if (trimmed === mathBlockDelimiter) {
        output.push(latexElement(mathLines.join('\n'), true))
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
    if (esmDepth > 0) {
      output.push(line)
      esmDepth = Math.max(0, esmDepth + bracketDelta(line))
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
    if (ESM_OPEN.test(trimmed)) {
      output.push(line)
      esmDepth = Math.max(0, bracketDelta(line))
      continue
    }
    if (line.includes('$')) {
      // Mask inline code spans (`` `$FOO` ``), JSX/HTML tags (including
      // their attribute values, e.g. `<Badge color="$primary">`), and a
      // JSX expression container (`{...}`) before scanning for math, so
      // none of them can be mistaken for a math delimiter and a math span
      // can never cross into one — a masked placeholder has no `$` in it,
      // so the scan below simply can't see inside one or pair a `$`
      // outside it with one that was inside it. What's left unmasked is
      // ordinary prose/JSX text content.
      const { masked, unmask } = maskInlineSpansForMath(line)
      // One combined pass, `$$...$$` tried before single-`$...$` at each
      // position: doing these as two sequential passes let the second
      // (single-`$`) regex re-match dollar signs the first pass had just
      // wrapped in backticks, corrupting its own output. Single-`$` inline
      // math (the other half of the KaTeX convention, e.g. `$F = S \times
      // e^{\,f\,T}$`, or a bare `$S$`) only counts when its content
      // doesn't start/end with whitespace, holds no further `$`, and looks
      // like real TeX (`hasTexSignal`) — the same rule KaTeX/Pandoc use to
      // tell real inline math from an ordinary sentence mentioning two
      // dollar amounts (`$50 and $100`, whose span content ends in a space
      // and so never matches). Neither alternative ever opens on `${`
      // (a template-literal interpolation, not a math delimiter). An
      // author-escaped `\$` (a literal dollar sign) is never treated as a
      // delimiter.
      const updatedMasked = masked.replace(
        /\$\$(?!\{)([^\n]+?)\$\$|(?<!\\)\$(?!\{)([^\s$](?:[^$\n]*[^\s$])?)\$/g,
        (whole: string, block: string | undefined, inline: string | undefined) => {
          if (block !== undefined) {
            converted = true
            return latexElement(unmask(block))
          }
          if (inline !== undefined && hasTexSignal(unmask(inline))) {
            converted = true
            return latexElement(unmask(inline))
          }
          return whole
        },
      )
      output.push(unmask(updatedMasked))
      continue
    }
    output.push(line)
  }
  // An unterminated `$$` block means the source was malformed to begin
  // with; leave it untouched rather than eating the rest of the page into
  // one giant fenced block.
  if (mathBlockDelimiter) return { body: raw, converted: false }
  const protectedBody = front + output.join('\n')
  if (!converted) return { body: protectedBody, converted }
  // Math conversion must never turn a page that used to compile into one
  // that doesn't (e.g. a false-positive match that corrupts real code).
  // If the protected body fails to compile as MDX but the untouched
  // original did, the conversion made things worse — keep the original and
  // let the caller warn, rather than silently excluding the page later.
  try {
    compileSync(protectedBody, MDX_COMPILE_OPTIONS)
    return { body: protectedBody, converted }
  } catch {
    try {
      compileSync(raw, MDX_COMPILE_OPTIONS)
      return { body: raw, converted: false, guardTriggered: true }
    } catch {
      // The original didn't compile either (the usual case math protection
      // exists for) — the protected attempt is still the better bet.
      return { body: protectedBody, converted }
    }
  }
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
      const isBareIdentifier = BARE_IDENTIFIER_PATH.test(value) && !JS_LITERAL_KEYWORDS.has(value)
        && !declared.has(root) && !safeBuiltinPath
      const shorthandMatch = value.match(BARE_OBJECT_SHORTHAND)
      const isDoubleBraceTemplate = shorthandMatch !== null && !declared.has(shorthandMatch[1])
      const isIssueList = /^[A-Za-z][A-Za-z0-9]*-\d+(?:\s*,\s*[A-Za-z][A-Za-z0-9]*-\d+)*$/.test(value)
      if ((isBareIdentifier || isDoubleBraceTemplate || isIssueList) && start !== undefined && end !== undefined) {
        // Escape every literal brace in the matched span rather than
        // rebuilding it from `value`, so this handles both `{name}` and
        // `{{name}}` (and any other brace nesting) the same way.
        const rawSpan = body.slice(start, end)
        edits.push({ start, end, value: rawSpan.replace(/\\/g, '\\\\').replace(/[{}]/g, '\\$&') })
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
export function splitFrontmatterBlock(raw: string): { front: string; body: string } {
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
  options: { onlyRenameLinkTag?: boolean; fernLinks?: boolean } = {},
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

    // Fern's `<Download src>` and `<Button href>` are links: a plain anchor keeps the target and the label.
    if (options.fernLinks && isJsx && (node.name === 'Download' || node.name === 'Button') && !declared.has(node.name)) {
      const openEnd = isSelfClosingJsx(text) || !node.children?.length ? end : node.children[0].position?.start.offset ?? start
      const rest = openEnd === end ? '' : renderChildrenSpan(node.children!, openEnd, node.children!.at(-1)!.position?.end.offset ?? end, body, renderNode)
        + renameTagOccurrences(body.slice(node.children!.at(-1)!.position?.end.offset ?? end, end), node.name, 'a')
      const open = body.slice(start, openEnd).replace(/\s(?:intent|variant|rounded|size|icon|rightIcon|minimal|mono)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, '')
      const anchor = node.name === 'Download' ? open.replace(/\ssrc=/, ' download href=') : open
      return renameTagOccurrences(anchor, node.name, 'a') + rest
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
function maskCode(body: string): { masked: string; unmask: (text: string) => string; openFence: string | null } {
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
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (codeFence) {
      fenceBuffer.push(line)
      // A closing fence has no info string. ` ```python` inside an open
      // Markdown fence is content, not a close; treating it as one can mask
      // every later HTML tag and leave React-invalid attributes untouched.
      if (fenceMatch && fenceMatch[1][0] === codeFence[0]
        && fenceMatch[1].length >= codeFence.length
        && /^\s*$/.test(line.slice(fenceMatch[0].length))) {
        lines.push(stash(fenceBuffer.join('\n')))
        codeFence = null
        fenceBuffer = []
      }
      continue
    }
    // A backtick fence's info string cannot hold a backtick (CommonMark):
    // "```bash npm install x ```" is inline code, and opening a fence on it
    // would hide the rest of the page from every rename.
    if (fenceMatch && !(fenceMatch[1][0] === '`' && line.slice(fenceMatch[0].length).includes('`'))) {
      codeFence = fenceMatch[1]
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
    openFence: codeFence,
  }
}

/**
 * Mintlify compiles every snippet as its own MDX file, where a fence left open
 * ends at EOF. Inlined into a page it would swallow the tags that follow, so
 * close it (same character, same length) on its own line. Balanced input is
 * returned unchanged.
 */
export function closeOpenFence(body: string): string {
  const { openFence } = maskCode(body)
  return openFence ? `${body}${body.endsWith('\n') ? '' : '\n'}${openFence}\n` : body
}

/**
 * Indent every line of an inlined snippet after the first by `indent`, the
 * column its tag started at, so a multi-line snippet stays inside the element
 * or list item that held the tag (its first line already sits there). Lines
 * inside a JS expression, an ESM block or a JSX attribute are left alone:
 * indenting them would change the text of a multi-line template literal. So is
 * every line of a fenced code block, fences included: the code stays exactly as
 * written. A snippet that does not parse as MDX on its own is returned unchanged.
 */
export function indentSnippetLines(snippet: string, indent: string): string {
  if (!indent || !snippet.includes('\n')) return snippet
  let tree: MdxOffsetNode
  try { tree = descriptionParser.parse(snippet) as MdxOffsetNode } catch { return snippet }
  const verbatim: Array<[number, number]> = []
  const fenced: Array<[number, number]> = []
  const keep = (node: { position?: MdxOffsetNode['position'] }, into = verbatim): void => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (start !== undefined && end !== undefined) into.push([start, end])
  }
  const visit = (node: MdxOffsetNode & { attributes?: Array<{ position?: MdxOffsetNode['position'] }> }): void => {
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression' || node.type === 'mdxjsEsm') keep(node)
    if (node.type === 'code') keep(node, fenced)
    node.attributes?.forEach((attribute) => keep(attribute))
    node.children?.forEach(visit)
  }
  visit(tree)
  let lineStart = 0
  return snippet.split('\n').map((line, index) => {
    const start = lineStart
    lineStart += line.length + 1
    // A continuation line that begins inside a verbatim span is part of its text, and any line of a code block is code.
    if (index === 0 || line.trim() === '' || verbatim.some(([from, to]) => from < start && start < to)
      || fenced.some(([from, to]) => from < start + line.length + 1 && start < to)) return line
    return indent + line
  }).join('\n')
}

/**
 * `body` as `replaceOutsideCode` hands it to a transform (fenced and inline code masked), and whether a fence is never closed,
 * so that everything after it is masked: a line that starts with a fence mark inside a template literal does that.
 */
export function maskedOutsideCode(body: string): { text: string; openFence: boolean } {
  const { masked, openFence } = maskCode(body)
  return { text: masked, openFence: openFence !== null }
}

/**
 * Apply a textual rename to the WHOLE body outside fenced/inline code (via
 * `maskCode`), so a match may span multiple lines.
 */
export function replaceOutsideCode(body: string, transform: (whole: string) => string): string {
  const { masked, unmask } = maskCode(body)
  return unmask(transform(masked))
}

/**
 * The one way the migrator emits an MDX comment. A `*\/` inside `text` would
 * close the comment early, so interpolated paths and source text are defused.
 */
export function mdxComment(text: string): string {
  return `{/*${text.replace(/\*\//g, '* /')}*/}`
}

/**
 * `replaceOutsideCode` that also leaves existing `{/* ... *\/}` comments alone,
 * so a rewrite cannot nest (and thereby corrupt) a comment inside another one.
 */
export function replaceOutsideCodeAndComments(body: string, transform: (whole: string) => string): string {
  return replaceOutsideCode(body, (masked) => {
    // Equivalent to splitting on /\{\s*\/\*[\s\S]*?\*\/\s*\}/ but linear: each `*/` that is followed by `\s*}` is
    // found once, and every opener takes the first such end after its own `/*`.
    const ends: Array<number> = []
    const closer = /\*\/\s*\}/y
    for (let at = masked.indexOf('*/'); at !== -1; at = masked.indexOf('*/', at + 1)) {
      closer.lastIndex = at
      if (closer.test(masked)) ends.push(at)
    }
    const opener = /\{\s*\/\*/y
    const out: Array<string> = []
    let last = 0
    let next = 0
    for (let start = masked.indexOf('{'); start !== -1; start = masked.indexOf('{', start + 1)) {
      opener.lastIndex = start
      if (!opener.test(masked)) continue
      while (next < ends.length && ends[next] < opener.lastIndex) next++
      if (next === ends.length) break
      const end = /\*\/\s*\}/y
      end.lastIndex = ends[next]
      end.test(masked)
      out.push(transform(masked.slice(last, start)), masked.slice(start, end.lastIndex))
      last = end.lastIndex
      start = last - 1
    }
    out.push(transform(masked.slice(last)))
    return out.join('')
  })
}

/**
 * Fern authors often link sibling MDX files from Card props and Markdown.
 * Resolve only links to files that actually became pages; unknown paths,
 * external URLs, assets, and examples retain their authored destinations.
 */
export function rewriteFernRelativePageLinks(
  body: string,
  currentSourcePath: string,
  routesBySourcePath: ReadonlyMap<string, string>,
): string {
  const rewrite = (target: string): string => {
    if (!target || target.startsWith('/') || target.startsWith('#') || target.startsWith('?')
      || target.includes('\\') || /[\u0000-\u001f\u007f]/.test(target)
      || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)) return target
    const suffixAt = target.search(/[?#]/)
    const pathname = suffixAt < 0 ? target : target.slice(0, suffixAt)
    const suffix = suffixAt < 0 ? '' : target.slice(suffixAt)
    if (!pathname || pathname.startsWith('//') || pathname.split('/').some((part) => /%2f|%5c/i.test(part))) return target
    const source = posix.normalize(posix.join(posix.dirname(currentSourcePath.replace(/\\/g, '/')), pathname))
    const candidates = /\.mdx?$/i.test(source) ? [source] : [source, `${source}.mdx`, `${source}.md`, `${source}/index.mdx`, `${source}/index.md`]
    const route = candidates.map((candidate) => routesBySourcePath.get(candidate)).find(Boolean)
    return route ? `/${route.replace(/^\/+/, '')}${suffix}` : target
  }
  return replaceOutsideCode(body, (text) => text
    .replace(/(\]\()(<[^>\n]+>|[^\s)]+)(?=\s|\))/g,
      (_match, opening: string, target: string) => `${opening}${target.startsWith('<') && target.endsWith('>') ? `<${rewrite(target.slice(1, -1))}>` : rewrite(target)}`)
    .replace(/(\b(?:href|to)\s*=\s*)(["'])([^"'\n]+)\2/g,
      (_match, opening: string, quote: string, target: string) => `${opening}${quote}${rewrite(target)}${quote}`)
    .replace(/(\b(?:href|to)\s*=\s*\{\s*)(["'])([^"'\n]+)\2(?=\s*\})/g,
      (_match, opening: string, quote: string, target: string) => `${opening}${quote}${rewrite(target)}${quote}`))
}

/**
 * Mintlify renders a component's `./x` or `../x` href as an anchor the browser
 * resolves against the page URL, but Thally's Card keeps only root-absolute
 * hrefs and `thally check` validates only those. Rewrite each to the path the
 * browser reaches from `pagePath`, the route the page is served at. A
 * directory index keeps its parent's route (`guides/index.mdx` has the id
 * `guides` and is served at `/guides`, as on Mintlify), so `./x` there
 * resolves to `/x`, as the author saw it. Markdown links stay browser-relative.
 * A href that climbs above the site root stops at the root, as the browser
 * does, so `../x` on a top-level page is `/x`.
 */
export function rewriteRelativeJsxHrefs(body: string, pagePath: string): string {
  const rewrite = (target: string): string => {
    if (!/^\.\.?\//.test(target) || target.includes('\\') || /[\u0000-\u001f\u007f]/.test(target)) return target
    const suffixAt = target.search(/[?#]/)
    const pathname = suffixAt < 0 ? target : target.slice(0, suffixAt)
    // A percent-encoded dot or slash is read differently by the browser than by a plain split.
    if (/%2e|%2f|%5c/i.test(pathname)) return target
    const segments = pagePath.split('/').slice(0, -1)
    for (const part of pathname.split('/')) {
      if (part === '..') {
        segments.pop()
      } else if (part !== '.' && part !== '') {
        segments.push(part)
      }
    }
    return `/${segments.join('/')}${pathname.endsWith('/') && segments.length > 0 ? '/' : ''}${suffixAt < 0 ? '' : target.slice(suffixAt)}`
  }
  return replaceOutsideCodeAndComments(body, (text) => text
    .replace(/((?<![\w-])href\s*=\s*)(["'])([^"'\n]+)\2/g,
      (_match, opening: string, quote: string, target: string) => `${opening}${quote}${rewrite(target)}${quote}`)
    .replace(/((?<![\w-])href\s*=\s*\{\s*)(["'])([^"'\n]+)\2(?=\s*\})/g,
      (_match, opening: string, quote: string, target: string) => `${opening}${quote}${rewrite(target)}${quote}`))
}

/** `[start, end)` offsets of every template literal in the estrees of `body`'s ESM blocks, expressions and JSX attribute expressions, or null when it does not parse. */
function templateLiteralRanges(body: string): Array<[number, number]> | null {
  let tree: MdxOffsetNode
  try {
    tree = descriptionParser.parse(body) as MdxOffsetNode
  } catch {
    return null
  }
  const ranges: Array<[number, number]> = []
  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as { type?: unknown; start?: unknown; end?: unknown }
    if (node.type === 'TemplateLiteral' && typeof node.start === 'number' && typeof node.end === 'number') ranges.push([node.start, node.end])
    for (const child of Object.values(node)) scan(child)
  }
  scan(tree)
  return ranges.sort((left, right) => left[0] - right[0])
}

/**
 * The `[start, end)` offsets in `body`, in document order, of every template literal the page's JavaScript holds
 * (in an `export`, an expression or a JSX attribute): a code sample in a string, whose lines are text even when one
 * reads `import x from 'y'`. The frontmatter is blanked first, as YAML is not MDX. What stops the parse and later
 * passes repair anyway is set right for the read, by edits that only blank or insert, so the offsets map back: an HTML
 * comment is blanked, and an unmatched closing tag and a prose brace that acorn rejects (`/{chainId?}`) get a backslash.
 * Empty when the page still does not parse, for example with an HTML tag that is never closed.
 */
export function esmTemplateLiteralRanges(body: string): Array<[number, number]> {
  const text = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, (frontmatter) => frontmatter.replace(/[^\r\n]/g, ' '))
  const direct = templateLiteralRanges(text)
  if (direct) return direct
  const blanked = text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '))
  const repaired = escapeUnparseableExpressions(escapeUnmatchedClosingTags(blanked).body)
  const ranges = templateLiteralRanges(repaired.body)
  if (!ranges) return []
  // Each escape only inserts a backslash before a `{` or `<`, so the inserted positions are where the two texts first differ.
  const inserted: Array<number> = []
  for (let at = 0, source = 0; at < repaired.body.length; at++) {
    if (repaired.body[at] === blanked[source]) source++
    else inserted.push(at)
  }
  const original = (offset: number): number => offset - inserted.filter((at) => at < offset).length
  return ranges.map(([start, end]) => [original(start), original(end)])
}

/** Convert Fern's indented file-list shorthand to Thally's nested Tree nodes. */
function normalizeFernFileTrees(body: string): string {
  return replaceOutsideCode(body, (whole) => whole.replace(/<FileTree\s*>\s*\n([\s\S]*?)\n\s*<\/FileTree>/g,
    (original: string, contents: string) => {
      const lines = contents.split(/\r?\n/).filter((line) => line.trim())
      if (!lines.length) return original
      const nodes: Array<{ indent: number; name: string; isFolder: boolean }> = []
      for (const line of lines) {
        const match = /^( *)(?:-|\*|\+)\s+(.+?)\s*$/.exec(line)
        if (!match || match[1].length % 2 !== 0 || match[2].includes('\u0000')) return original
        nodes.push({ indent: match[1].length / 2, name: match[2], isFolder: match[2].endsWith('/') })
      }
      const output = ['<Tree>']
      const folders: Array<number> = []
      for (const node of nodes) {
        while (folders.length > node.indent) {
          output.push('</Folder>')
          folders.pop()
        }
        // A child without a parent folder is not a reliable tree. Retain the
        // Fern source so migration validation can report it explicitly.
        if (node.indent > folders.length || (node.indent > 0 && folders.length === 0)) return original
        const name = `{${JSON.stringify(node.name)}}`
        if (node.isFolder) {
          output.push(`<Folder name=${name} defaultOpen>`)
          folders.push(node.indent)
        } else {
          output.push(`<File name=${name} />`)
        }
      }
      while (folders.length) {
        output.push('</Folder>')
        folders.pop()
      }
      output.push('</Tree>')
      return output.join('\n')
    }))
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
  return replaceOutsideCode(unwrapHtmlCommentInMdxComment(body), (whole) => whole.replace(/<!--([\s\S]*?)-->/g, (_match, comment: string) => mdxComment(comment)))
}

/**
 * An MDX comment whose whole content is one HTML comment (`{/* <!-- note --> *\/}`) becomes an MDX comment with that text (`{/* note *\/}`),
 * outside code. Converting the HTML comment inside it would nest one MDX comment in another: the first `*\/}` closes the outer comment
 * and the rest of it shows on the page, where Mintlify renders nothing. Nothing else changes: an HTML comment that shares an MDX comment
 * with other text is still converted as before. The text between the markers holds neither `-->` nor `*\/`.
 */
function unwrapHtmlCommentInMdxComment(body: string): string {
  return replaceOutsideCode(body, (text) => {
    const opener = /\{\s*\/\*\s*<!--/g
    const closer = /\s*\*\/\s*\}/y
    let out = ''
    let copied = 0
    // The next `-->` and `*/` at or after the current opener (-1: none left). Each is searched for again only once an opener has passed it, so the scan stays linear.
    let dash = -2
    let star = -2
    for (let found = opener.exec(text); found; found = opener.exec(text)) {
      const inner = opener.lastIndex
      if (dash !== -1 && dash < inner) dash = text.indexOf('-->', inner)
      if (dash === -1) break
      if (star !== -1 && star < inner) star = text.indexOf('*/', inner)
      closer.lastIndex = dash + 3
      if ((star !== -1 && star < dash) || !closer.test(text)) continue
      out += `${text.slice(copied, found.index)}{/*${text.slice(inner, dash)}*/}`
      copied = opener.lastIndex = closer.lastIndex
    }
    return out + text.slice(copied)
  })
}

/**
 * Rewrite Fern's callout intents to Thally's fixed callout tags without
 * touching fenced code. Delimiters are tracked with a stack so nested and
 * sibling callouts each close with the tag their own opening intent chose.
 * A single scan is required: collecting every opener before visiting any
 * closer incorrectly pairs sibling and nested callouts.
 */
function normalizeFernCallouts(body: string): string {
  return replaceOutsideCode(body, (whole) => {
    const openTags: Array<string | null> = []
    const output: string[] = []
    let cursor = 0
    while (cursor < whole.length) {
      const opening = whole.indexOf('<Callout', cursor)
      const closing = whole.indexOf('</Callout>', cursor)
      const next = opening < 0 ? closing : closing < 0 ? opening : Math.min(opening, closing)
      if (next < 0) break
      output.push(whole.slice(cursor, next))
      if (next === closing) {
        const tag = openTags.pop()
        output.push(tag ? `</${tag}>` : '</Callout>')
        cursor = next + '</Callout>'.length
        continue
      }
      const attributeStart = next + '<Callout'.length
      if (!/[\s/>]/.test(whole[attributeStart] ?? '')) {
        output.push('<Callout')
        cursor = attributeStart
        continue
      }
      // JSX attributes may contain quoted `>` or expression comparisons.
      // Locate the delimiter in one pass instead of using a backtracking
      // regex over arbitrary source content.
      let end = attributeStart
      let quote: string | null = null
      let expressionDepth = 0
      for (; end < whole.length; end++) {
        const character = whole[end]
        if (quote) {
          if (character === quote && whole[end - 1] !== '\\') quote = null
        } else if (character === '"' || character === "'") {
          quote = character
        } else if (character === '{') {
          expressionDepth++
        } else if (character === '}' && expressionDepth > 0) {
          expressionDepth--
        } else if (character === '>' && expressionDepth === 0) {
          break
        }
      }
      if (end === whole.length) {
        output.push(whole.slice(next))
        cursor = whole.length
        break
      }
      const attributes = whole.slice(attributeStart, end)
      const intent = findStaticCalloutIntent(attributes)
      const isSelfClosing = attributes.trimEnd().endsWith('/')
      if (!intent) {
        output.push(whole.slice(next, end + 1))
        if (!isSelfClosing) openTags.push(null)
      } else {
        const value = intent.value.toLowerCase()
        const tag = value === 'warning' ? 'Warning'
          : value === 'success' || value === 'tip' ? 'Tip'
            : value === 'error' || value === 'danger' ? 'Error' : 'Note'
        output.push(`<${tag}${attributes.slice(0, intent.start)}${attributes.slice(intent.end)}>`)
        if (!isSelfClosing) openTags.push(tag)
      }
      cursor = end + 1
    }
    output.push(whole.slice(cursor))
    return output.join('')
  })
}

/** Find only a static, quoted intent attribute; preserve every other prop. */
function findStaticCalloutIntent(attributes: string): { start: number; end: number; value: string } | null {
  let cursor = 0
  while (cursor < attributes.length) {
    const start = cursor
    while (/\s/.test(attributes[cursor] ?? '')) cursor++
    if (cursor === start) { cursor++; continue }
    const nameStart = cursor
    while (/[A-Za-z0-9_-]/.test(attributes[cursor] ?? '')) cursor++
    const name = attributes.slice(nameStart, cursor)
    while (/\s/.test(attributes[cursor] ?? '')) cursor++
    if (attributes[cursor] !== '=') continue
    cursor++
    while (/\s/.test(attributes[cursor] ?? '')) cursor++
    const quote = attributes[cursor]
    if (quote !== '"' && quote !== "'") {
      // Other props may be JSX expressions. Skip balanced braces so a
      // string inside an expression cannot masquerade as an attribute.
      if (quote === '{') {
        let depth = 0
        do {
          if (attributes[cursor] === '{') depth++
          if (attributes[cursor] === '}') depth--
          cursor++
        } while (cursor < attributes.length && depth > 0)
      } else {
        while (cursor < attributes.length && !/\s/.test(attributes[cursor])) cursor++
      }
      continue
    }
    const valueStart = ++cursor
    while (cursor < attributes.length && attributes[cursor] !== quote) cursor++
    const value = attributes.slice(valueStart, cursor)
    if (cursor < attributes.length) cursor++
    if (name === 'intent') return { start, end: cursor, value }
  }
  return null
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
  let result = body
  for (let depth = 0; depth < 20; depth += 1) {
    const updated = result.replace(/<Tabs\b([^>]*)>((?:(?!<Tabs\b)[\s\S])*?)<\/Tabs>/g, (_match, attributes: string, inner: string) => {
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
      .replace(/\s*values=\{[^{}]*\}/g, '')
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
    return `<ThallyTabs${cleanedAttributes}>${rewrittenInner}</ThallyTabs>`
    })
    if (updated === result) break
    result = updated
  }
  return result.replace(/<ThallyTabs\b/g, '<Tabs').replace(/<\/ThallyTabs>/g, '</Tabs>')
}

/**
 * A TabItem outside any <Tabs>...</Tabs> pair (malformed source) never reaches normalizeDocusaurusTabs' block match; fall back to
 * its own label/value so it still renders as a Tab. Only an opener with a `</TabItem>` of its own is mapped: a lone `<TabItem>`
 * named in prose would become an unclosed `<Tab>` and fail the page, and is left to the orphan-tag escape.
 */
function normalizeStrayTabItems(body: string): string {
  const tags = [...body.matchAll(/<TabItem\b([^<>]*)>|<\/TabItem>/g)].filter((tag) => !/\/$/.test(tag[1] ?? ''))
  const openers: Array<number> = []
  const paired = new Set<number>()
  tags.forEach((tag, index) => {
    if (tag[0] !== '</TabItem>') openers.push(index)
    else if (openers.length > 0) {
      paired.add(openers.pop()!)
      paired.add(index)
    }
  })
  let result = ''
  let cursor = 0
  tags.forEach((tag, index) => {
    if (!paired.has(index)) return
    const attributes = tag[1] ?? ''
    const title = attributes.match(/\blabel=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
      ?? attributes.match(/\bvalue=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(Boolean)
      ?? 'Tab'
    result += `${body.slice(cursor, tag.index)}${tag[0] === '</TabItem>' ? '</Tab>' : `<Tab title="${title.replace(/"/g, '&quot;')}">`}`
    cursor = tag.index! + tag[0].length
  })
  return result + body.slice(cursor)
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

/** Mintlify allows presentational JSX in Update labels; Thally uses the label as an anchor id. */
function normalizeMintlifyUpdateLabels(body: string): string {
  return body.replace(/(<Update\b[^>]*\blabel=)\{(<\>[\s\S]*?<\/\>)\}/g, (match, prefix: string, fragment: string) => {
    let root: DescriptionNode
    try {
      root = descriptionParser.parse(fragment) as DescriptionNode
    } catch {
      return match
    }
    const plainText = (node: DescriptionNode): string | null => {
      // Preserve only parsed text nodes. Dropping markup with a regex can
      // leave a partial tag in the output when an attribute contains `>`.
      if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? ''
      if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression' || node.type === 'mdxjsEsm') return null
      const parts = (node.children ?? []).map(plainText)
      return parts.some((part) => part === null) ? null : parts.join('')
    }
    const label = plainText(root)?.replace(/\s+/g, ' ').trim()
    // Dynamic labels cannot be flattened safely; preserve their source form.
    return label && !/[{}]/.test(label) ? `${prefix}{${JSON.stringify(label)}}` : match
  })
}

/** Preserve Mintlify's generated `param-*` links on authored settings fields. */
function normalizeMintlifyParameterAnchors(body: string): string {
  const seen = new Set<string>()
  const anchorFor = (name: string): string => {
    const id = `param-${name.toLowerCase().replace(/[._]/g, '-')}`
    if (seen.has(id)) return ''
    seen.add(id)
    return `<a id="${id}"></a>\n`
  }
  // `replaceOutsideCode` masks inline backticks as well as fenced code, so
  // scan heading lines separately to retain the authored setting name.
  let fence: string | undefined
  const withHeadings = body.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length
        && /^\s*$/.test(line.slice(marker[0].length))) fence = undefined
      return line
    }
    if (fence) return line
    const heading = line.match(/^ {0,3}#{1,6}\s+`([A-Za-z][A-Za-z0-9._-]*)`(?:\s|$)/)
    return heading ? `${anchorFor(heading[1])}${line}` : line
  }).join('\n')
  return replaceOutsideCode(withHeadings, (segment) => segment
    .replace(/<(ResponseField|ParamField)\b([^>]*?)\bname=(?:"([A-Za-z][A-Za-z0-9._-]*)"|'([A-Za-z][A-Za-z0-9._-]*)')([^>]*)>/g,
      (match: string, _tag: string, _before: string, doubleQuoted: string, singleQuoted: string) =>
        `${anchorFor(doubleQuoted ?? singleQuoted)}${match}`))
}

interface FenceLine { index: number; indent: string; char: string; length: number; info: string; rest: string }

function matchFenceLine(line: string): FenceLine | null {
  const match = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
  if (!match) return null
  return { index: -1, indent: match[1], char: match[2][0], length: match[2].length, info: match[3].trim(), rest: match[3] }
}

/**
 * Widen an outer fence (for example a ```mdx block demonstrating authored
 * Markdown) whose content contains a same-or-greater-length nested fence.
 * CommonMark has no concept of fence nesting, so an inner fence of matching
 * length closes the outer one early and strands the rest as raw JSX/markdown.
 * A nested fence is identified by carrying an info string; a bare fence line
 * always closes the innermost open block, matching authoring convention.
 */
function normalizeNestedCodeFences(body: string): string {
  const lines = body.split('\n')
  const fences = lines
    .map((line, index) => {
      const fence = matchFenceLine(line)
      return fence ? { ...fence, index } : null
    })
    .filter((fence): fence is FenceLine => fence !== null)
  if (fences.length === 0) return body

  interface Block { open: FenceLine; close: FenceLine; children: Array<Block> }
  const stack: Array<{ open: FenceLine; children: Array<Block> }> = []
  const roots: Array<Block> = []
  for (const fence of fences) {
    const top = stack.at(-1)
    if (top && fence.info === '' && fence.char === top.open.char && fence.length >= top.open.length) {
      stack.pop()
      const block: Block = { open: top.open, close: fence, children: top.children }
      const parent = stack.at(-1)
      if (parent) parent.children.push(block)
      else roots.push(block)
    } else {
      stack.push({ open: fence, children: [] })
    }
  }
  // An unresolved stack means the fences do not actually nest; leave the
  // source untouched rather than guess at intent.
  if (stack.length > 0) return body

  const widenedLengths = new Map<number, number>()
  function requiredLength(block: Block): number {
    const deepestChild = Math.max(0, ...block.children.map(requiredLength))
    const length = Math.max(block.open.length, deepestChild > 0 ? deepestChild + 1 : 0)
    widenedLengths.set(block.open.index, length)
    widenedLengths.set(block.close.index, length)
    return length
  }
  roots.forEach(requiredLength)

  return lines
    .map((line, index) => {
      const targetLength = widenedLengths.get(index)
      const fence = targetLength ? matchFenceLine(line) : null
      if (!targetLength || !fence || targetLength <= fence.length) return line
      return `${fence.indent}${fence.char.repeat(targetLength)}${fence.rest}`
    })
    .join('\n')
}

/** Replace fenced code blocks and inline code spans with same-length filler. */
function maskCodeRegions(body: string): string {
  let inFence = false
  return body.split('\n').map((line) => {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      return ' '.repeat(line.length)
    }
    if (inFence) return ' '.repeat(line.length)
    return line.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length))
  }).join('\n')
}

/**
 * Read a JSX tag's attributes from `from` (just after the tag name) to its
 * closing `>`, ignoring any `>` inside quotes or `{...}` expressions. Linear.
 * Returns the index after `>` and whether the tag self-closes, or null when it
 * is not a well-formed tag (a bare `<`, or no end). Returns UNTERMINATED when
 * an open brace/quote runs to end of input: callers stop scanning, since every
 * later opener would rescan the same tail (quadratic on `'<a {'.repeat(n)`).
 */
const UNTERMINATED = 'unterminated'
function readTagEnd(text: string, from: number): { end: number; selfClosing: boolean; attributes: string } | null | typeof UNTERMINATED {
  if (from < text.length && !/[\s/>]/.test(text[from])) return null
  let depth = 0
  let quote = ''
  for (let i = from; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\' && depth > 0) i++
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'" || (char === '`' && depth > 0)) {
      quote = char
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
    } else if (depth === 0) {
      if (char === '<') return null
      if (char === '>') {
        const selfClosing = text[i - 1] === '/' && i > from
        return { end: i + 1, selfClosing, attributes: text.slice(from, selfClosing ? i - 1 : i) }
      }
    }
  }
  return quote || depth > 0 ? UNTERMINATED : null
}

/** Add `titleSize="p"` to every `<Steps>` opener (also `<Steps />`) that lacks one. */
function pinStepsTitleSize(body: string): string {
  let result = ''
  let cursor = 0
  for (const match of body.matchAll(/<Steps(?=[\s/>])/g)) {
    if (match.index < cursor) continue
    const tag = readTagEnd(body, match.index + match[0].length)
    if (tag === UNTERMINATED) break
    if (!tag) continue
    const attributesEnd = tag.end - (tag.selfClosing ? 2 : 1)
    if (/\btitleSize\s*=/.test(tag.attributes)) continue
    result += `${body.slice(cursor, attributesEnd).trimEnd()} titleSize="p"${tag.selfClosing ? ' /' : ''}>`
    cursor = tag.end
  }
  return result + body.slice(cursor)
}

/**
 * Mintlify renders `<video autoPlay>` muted, looping and inline, so it starts on
 * its own where browsers refuse autoplay with sound. Add the ones of `muted`,
 * `loop` and `playsInline` an `autoPlay` video lacks, right after `autoPlay` (on
 * a line of its own when `autoPlay` has one). A video without `autoPlay`, or with
 * `autoPlay={false}`, is left as it is.
 */
function addMintlifyVideoAttributes(body: string): string {
  if (!body.includes('<video')) return body
  interface VideoAttribute { type: string; name?: string; value?: unknown; position?: MdxOffsetNode['position'] }
  let result = ''
  let cursor = 0
  for (const match of body.matchAll(/<video(?=[\s/>])/g)) {
    if (match.index < cursor) continue
    const tag = readTagEnd(body, match.index + match[0].length)
    if (tag === UNTERMINATED) break
    if (!tag) continue
    let attributes: Array<VideoAttribute>
    try {
      attributes = ((descriptionParser.parse(`<video${tag.attributes}/>`) as { children?: Array<{ attributes?: Array<VideoAttribute> }> }).children?.[0]?.attributes) ?? []
    } catch {
      continue
    }
    const named = (name: string): VideoAttribute | undefined => attributes.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name?.toLowerCase() === name.toLowerCase())
    const autoPlay = named('autoPlay')
    const start = autoPlay?.position?.start.offset
    const end = autoPlay?.position?.end.offset
    const off = typeof autoPlay?.value === 'object' && (autoPlay.value as { value?: string } | null)?.value?.trim() === 'false'
    const missing = ['muted', 'loop', 'playsInline'].filter((name) => !named(name))
    if (!autoPlay || off || missing.length === 0 || start === undefined || end === undefined) continue
    // Offsets are in the parsed tag, which starts where the tag does.
    const at = match.index + end
    const indent = body.slice(body.lastIndexOf('\n', match.index + start - 1) + 1, match.index + start)
    const eol = /^[ \t]*(\r?\n)/.exec(body.slice(at))?.[1]
    const insert = eol && /^[ \t]*$/.test(indent) ? missing.map((name) => `${eol}${indent}${name}`).join('') : missing.map((name) => ` ${name}`).join('')
    result += body.slice(cursor, at) + insert
    cursor = at
  }
  return result + body.slice(cursor)
}

/**
 * Escape closing tags that have no matching real opener (outside code), e.g.
 * a generator that wrote `\<Warning>` ... `</Warning>`: the escaped opener is
 * literal text, so the bare closer is a compile error. Escaping the closer the
 * same way keeps the page. Linear: one regex pass with a per-name open count.
 * Returns the text of each closing tag repaired; `body` is returned unchanged
 * when there are none.
 */
export function escapeUnmatchedClosingTags(body: string): { body: string; escaped: Array<string> } {
  const masked = maskCodeRegions(body)
  const tagPattern = /(\\?)<(\/?)([A-Za-z][\w.:-]*)/g
  const open = new Map<string, number>()
  const edits: Array<{ start: number; end: number }> = []
  for (let match = tagPattern.exec(masked); match; match = tagPattern.exec(masked)) {
    const [whole, escaped, closing, name] = match
    const tag = readTagEnd(masked, match.index + whole.length)
    if (tag === UNTERMINATED) break
    if (!tag) continue
    tagPattern.lastIndex = tag.end
    if (escaped || tag.selfClosing) continue
    if (!closing) {
      open.set(name, (open.get(name) ?? 0) + 1)
    } else if (open.get(name)) {
      open.set(name, open.get(name)! - 1)
    } else {
      edits.push({ start: match.index, end: tag.end })
    }
  }
  if (edits.length === 0) return { body, escaped: [] }
  let result = ''
  let cursor = 0
  for (const { start } of edits) {
    result += `${body.slice(cursor, start)}\\`
    cursor = start
  }
  return { body: result + body.slice(cursor), escaped: edits.map(({ start, end }) => body.slice(start, end)) }
}

/** Whether `text[index]` is escaped, that is preceded by an odd run of backslashes. */
function isBackslashEscaped(text: string, index: number): boolean {
  let slashes = 0
  while (index - 1 - slashes >= 0 && text[index - 1 - slashes] === '\\') slashes++
  return slashes % 2 === 1
}

const MAX_EXPRESSION_REPAIRS = 50

/**
 * Escape prose braces that MDX reads as an expression acorn cannot parse
 * (`https://host/{chainId?}`); Mintlify shows them as literal text. Each round
 * compiles the page and, for an acorn failure inside an expression, escapes
 * every `{` of the balanced span around it: escaping only the outer one
 * would leave a nested `{y}` as a live expression that throws at render.
 * Fails closed: any other error (an `export`, a JSX attribute whose escaped
 * brace is no longer valid JSX, an unclosed brace) or more than 50 repairs
 * returns `body` unchanged. Otherwise `body` compiles, and `escaped` holds the
 * text of each span that got an escape.
 */
export function escapeUnparseableExpressions(body: string): { body: string; escaped: Array<string> } {
  let current = body
  const escaped: Array<string> = []
  for (let repairs = 0; ; repairs++) {
    let failure: { source?: string; ruleId?: string; place?: { offset?: number } } | null
    try {
      compileSync(current, MDX_COMPILE_OPTIONS)
      return { body: current, escaped }
    } catch (error) {
      failure = error as typeof failure
    }
    const offset = failure?.place?.offset
    if (repairs === MAX_EXPRESSION_REPAIRS || failure?.source !== 'micromark-extension-mdx-expression'
      || failure.ruleId !== 'acorn' || typeof offset !== 'number') return { body, escaped: [] }
    const masked = maskCodeRegions(current)
    // The offset is where acorn failed inside the expression, so its opening brace is the first unbalanced `{` before it.
    let opener = -1
    for (let i = offset - 1, depth = 0; i >= 0 && opener < 0; i--) {
      if (isBackslashEscaped(masked, i)) continue
      if (masked[i] === '}') depth++
      else if (masked[i] === '{') {
        if (depth === 0) opener = i
        else depth--
      }
    }
    if (opener < 0) return { body, escaped: [] }
    let braces: Array<number> = []
    let close = -1
    for (let i = opener, depth = 0; i < masked.length && close < 0; i++) {
      if (isBackslashEscaped(masked, i)) continue
      if (masked[i] === '{') {
        depth++
        braces.push(i)
      } else if (masked[i] === '}' && --depth === 0) {
        close = i
      }
    }
    if (close < 0) braces = [opener]
    escaped.push(current.slice(opener, close < 0 ? opener + 1 : close + 1))
    let cursor = 0
    let result = ''
    for (const brace of braces) {
      result += `${current.slice(cursor, brace)}\\`
      cursor = brace
    }
    current = result + current.slice(cursor)
  }
}

function isKnownComponentName(name: string, body: string): boolean {
  if (isThallyBuiltinComponent(name)) return true
  if (new RegExp(`^\\s*export\\s+(?:const|function|default\\s+function)\\s+${name}\\b`, 'm').test(body)) return true
  if (new RegExp(`^\\s*import\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name})\\s+from\\s+['"][^'"]+['"]`, 'm').test(body)) return true
  return false
}

/**
 * Mintlify content occasionally uses a bare capitalized word in angle
 * brackets as a prose placeholder — for example "<Feature> requires a Pro
 * plan" — which is invalid JSX: a tag must self-close or have a matching
 * close. Left alone, this crashes MDX compilation for the whole page. A tag
 * name that never closes or self-closes anywhere in the document, and isn't
 * a known built-in, imported, or locally declared component, is almost
 * certainly such a placeholder — escape it to literal text rather than
 * losing the page.
 */
function escapeOrphanCapitalizedTags(body: string): string {
  const masked = maskCodeRegions(body)
  // The attribute group is lazy so a trailing self-close slash is captured by
  // its own group instead of being swallowed as the last attribute character.
  const tagPattern = /<(\/?)([A-Z][A-Za-z0-9]*)(?:\s+[^<>]*?)?(\/?)>/g
  const opens = new Map<string, Array<{ start: number; end: number }>>()
  const closedOrSelfClosed = new Set<string>()
  for (const match of masked.matchAll(tagPattern)) {
    const [full, closing, name, selfClosing] = match
    if (closing || selfClosing) {
      closedOrSelfClosed.add(name)
      continue
    }
    const start = match.index!
    const list = opens.get(name) ?? []
    list.push({ start, end: start + full.length })
    opens.set(name, list)
  }
  const edits: Array<{ start: number; end: number }> = []
  for (const [name, ranges] of opens) {
    if (closedOrSelfClosed.has(name) || isKnownComponentName(name, body)) continue
    edits.push(...ranges)
  }
  if (edits.length === 0) return body
  // The scan above is textual, so it cannot tell prose from a string inside an
  // expression or export. A page that already compiles needs no escaping;
  // never rewrite one.
  try {
    compileSync(body, MDX_COMPILE_OPTIONS)
    return body
  } catch {
    // Fails to compile: escape the placeholders below.
  }
  edits.sort((a, b) => a.start - b.start)
  let result = ''
  let cursor = 0
  for (const edit of edits) {
    result += body.slice(cursor, edit.start)
    result += body.slice(edit.start, edit.end).replace(/^</, '&lt;').replace(/>$/, '&gt;')
    cursor = edit.end
  }
  return result + body.slice(cursor)
}

const REACT_HOOK_NAMES = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer']

/**
 * Mintlify documents these seven hooks as pre-injected globals for a page's
 * inline `export const Widget = () => {...}` components. The migrator's
 * component extraction (components.ts) moves a component that really calls
 * one of these hooks into its own client module, so this is only a fallback
 * for a hook call the extractor doesn't own (for example directly in the
 * page body). Detection is fence-aware: merely showing `useState(...)` in a
 * documentation code sample must not import it — that import alone, unused
 * or not, marks the compiled page a Client Component and breaks the build.
 */
function injectReactHookImports(body: string): string {
  const masked = maskCodeRegions(body)
  const used = REACT_HOOK_NAMES.filter((hook) => (
    new RegExp(`\\b${hook}\\s*\\(`).test(masked)
    && !new RegExp(`import\\s*\\{[^}]*\\b${hook}\\b[^}]*\\}\\s*from\\s*['"]react['"]`).test(body)
  ))
  return used.length > 0 ? `import { ${used.join(', ')} } from 'react'\n\n${body}` : body
}

/**
 * An MDX expression that names something the page never defines throws a
 * ReferenceError when the page renders and fails the build, while Mintlify
 * renders it as nothing (`exactly one of {backfill, MV}.`). Match Mintlify:
 * drop the expression, or the JSX attribute that carries it, and say so once.
 */
export function removeUndefinedExpressions(body: string, warn?: (message: string) => void): string {
  if (!body.includes('{')) return body
  interface ExpressionNode extends MdxOffsetNode {
    attributes?: Array<{ type: string; value?: unknown; position?: MdxOffsetNode['position'] }>
  }
  let tree: ExpressionNode
  try {
    tree = descriptionParser.parse(body) as ExpressionNode
  } catch {
    return body
  }
  const esm: Array<string> = []
  const collect = (node: ExpressionNode): void => {
    if (node.type === 'mdxjsEsm' && node.value) esm.push(node.value)
    for (const child of node.children ?? []) collect(child)
  }
  collect(tree)
  const scope = pageScopeNames(esm)
  const edits: Array<{ start: number; end: number }> = []
  const removed = new Set<string>()
  const check = (expression: string, position: MdxOffsetNode['position']): void => {
    const names = unresolvedExpressionNames(expression, scope)
    const start = position?.start.offset
    const end = position?.end.offset
    if (names.length === 0 || start === undefined || end === undefined) return
    names.forEach((name) => removed.add(name))
    edits.push({ start, end })
  }
  const visit = (node: ExpressionNode): void => {
    if ((node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') && node.value !== undefined) {
      check(node.value, node.position)
    }
    for (const attribute of node.attributes ?? []) {
      const value = attribute.value
      if (attribute.type === 'mdxJsxExpressionAttribute' && typeof value === 'string') check(`{${value}}`, attribute.position)
      else if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
        check((value as { value: string }).value, attribute.position)
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  if (edits.length === 0) return body
  warn?.(`Expressions that use ${[...removed].map((name) => `"${name}"`).join(', ')} were removed so the page builds: ${removed.size === 1 ? 'the name is' : 'the names are'} not defined on this page. Define ${removed.size === 1 ? 'the name' : 'the names'} or escape the braces as \\{ \\} to show the text.`)
  return edits.sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + text.slice(edit.end), body)
}

/** Callout-style components that render a block; one that starts straight after a text line is read as part of that line's paragraph. */
const BLOCK_COMPONENT_NAMES = new Set(['Note', 'Warning', 'Info', 'Tip', 'Check', 'Danger', 'Error', 'Callout', 'Steps', 'Tabs', 'CodeGroup', 'Accordion', 'AccordionGroup', 'Expandable', 'Frame', 'CardGroup', 'Columns'])

/**
 * Put a blank line before a block component that starts on the line directly after text. Without it MDX folds the component into that
 * paragraph, the runtime serves a `<div>` inside a `<p>`, and the page fails to hydrate. Read from the syntax tree, so code fences,
 * comments and components nested in a line of prose are never touched.
 */
export function separateBlockComponents(body: string): string {
  if (!/\n[ \t]*<[A-Z]/.test(body)) return body
  interface FlowNode {
    type: string
    name?: string | null
    value?: string
    children?: Array<FlowNode>
    position?: { start: { offset?: number } }
  }
  let tree: FlowNode
  try {
    tree = descriptionParser.parse(body) as FlowNode
  } catch {
    return body
  }
  const inserts: Array<number> = []
  const visit = (node: FlowNode): void => {
    const children = node.children ?? []
    if (node.type === 'paragraph') {
      children.forEach((child, index) => {
        const start = child.position?.start.offset
        const before = children[index - 1]
        if (child.type !== 'mdxJsxTextElement' || !BLOCK_COMPONENT_NAMES.has(child.name ?? '') || start === undefined
          || before?.type !== 'text' || !/\S[ \t]*\n[ \t]*$/.test(before.value ?? '')) return
        inserts.push(body.lastIndexOf('\n', start - 1) + 1)
      })
    }
    children.forEach(visit)
  }
  visit(tree)
  return inserts.sort((a, b) => b - a).reduce((text, offset) => `${text.slice(0, offset)}\n${text.slice(offset)}`, body)
}

/** Keep authored paragraph styling without emitting an invalid <p><p> tree. */
export function normalizeFlowParagraphContainers(body: string): string {
  if (!body.includes('<p')) return body
  interface FlowNode {
    type: string
    name?: string | null
    children?: Array<FlowNode>
    position?: { start: { offset?: number }; end: { offset?: number } }
  }
  let tree: FlowNode
  try {
    tree = descriptionParser.parse(body) as FlowNode
  } catch {
    return body
  }
  const edits: Array<{ offset: number; value: string }> = []
  function visit(node: FlowNode): void {
    if (node.type === 'mdxJsxFlowElement' && node.name === 'p'
      && node.children?.some((child) => child.type === 'paragraph' || child.type === 'list' || child.type === 'mdxJsxFlowElement')) {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start !== undefined && end !== undefined && body.slice(start, start + 2) === '<p') {
        const closing = body.slice(start, end).match(/<\/p\s*>\s*$/i)
        if (closing?.index !== undefined) {
          edits.push({ offset: start + 1, value: 'div' })
          edits.push({ offset: start + closing.index + 2, value: 'div' })
        }
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  // Replace only the tag names; every class, inline style, and child stays
  // authored. Descending offsets keep nested paragraph wrappers stable.
  return edits.sort((a, b) => b.offset - a.offset)
    .reduce((text, edit) => text.slice(0, edit.offset) + edit.value + text.slice(edit.offset + 1), body)
}

/** Normalize only syntax Thally cannot render; supported source JSX stays intact. */
export function normalizeMdx(body: string, platform?: MigrationPlatform, unwrapMdxCodeBlocks = true): string {
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

  // A heading's explicit `{#custom-id}` anchor (see `normalizeExplicitHeadingIds`)
  // means the same thing on every platform, so — unlike the platform-specific
  // renames below — this always runs, even when `platform` is omitted.
  // `normalizeExplicitHeadingIds` also covers Docusaurus' `{/* #id */}`
  // comment form.
  const sourceBody = runDocusaurus && unwrapMdxCodeBlocks ? unwrapDocusaurusMdxCodeBlocks(body) : body
  let rewritten = normalizeExplicitHeadingIds(
    runFern ? normalizeFernFileTrees(normalizeFernCallouts(normalizeNestedCodeFences(sourceBody))) : normalizeNestedCodeFences(sourceBody),
    undefined,
    { headingMarkers: runMintlify },
  )
  // After the `{#id}` pass above, which would turn the marker this writes into an anchor element.
  if (runFern) rewritten = normalizeFernHeadingIds(rewritten)
  if (runDocusaurus) rewritten = normalizeDocusaurusAdmonitions(rewritten)
  if (runMintlify) rewritten = markMintlifyHeadings(rewritten)
  if (runDocusaurus) {
    // Docusaurus resolves GitHub emoji names in Markdown text. Leaving the
    // shortcodes literal makes comparison tables unreadable after import; the
    // code masker keeps examples and inline code byte-for-byte intact.
    rewritten = replaceOutsideCode(rewritten, (segment) => segment.replace(
      /:([+\w-]+):/g,
      (shortcode: string, name: string) => nameToEmoji[name] ?? shortcode,
    ))
    // Some authored JSX uses Docusaurus' runtime helper through `require()`
    // directly in a link attribute. That package is absent from a generated
    // Thally site; a static, confined path can be projected without running
    // source code or leaving a build-breaking module reference.
    rewritten = replaceOutsideCode(rewritten, (segment) => segment.replace(
      /\b(href|src)=\{\s*require\(\s*(['"])@docusaurus\/useBaseUrl\2\s*\)\.default\(\s*(['"])([^'"]+)\3\s*\)\s*\}/g,
      (original: string, attribute: string, _moduleQuote: string, _pathQuote: string, path: string) => {
        if (!/^[\w./~%-]+$/.test(path) || path.split('/').includes('..')) return original
        return `${attribute}="/${path.replace(/^\.\//, '').replace(/^\/+/, '')}"`
      },
    ))
    rewritten = replaceOutsideCode(rewritten, (segment) => normalizeDocusaurusThemedImages(normalizeDocusaurusAdmonitionTags(segment)))
    // Docusaurus injects these theme components globally. Thally also
    // exposes its equivalents globally, so source-only imports must not survive.
    rewritten = normalizeDocusaurusTabBlocks(normalizeDocusaurusTabs(removeGlobalDocusaurusImports(rewritten)))
    // Data-only @site imports are often used solely by Docusaurus' tab
    // metadata. Once those props are projected to <Tab> labels, remove only
    // imports whose binding has no remaining use on the page.
    rewritten = replaceOutsideCode(rewritten, (segment) => segment.replace(
      /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])(@site\/[^'"]+)\2\s*;?/g,
      (statement: string, binding: string, _quote: string, _source: string, offset: number) => {
        const withoutStatement = segment.slice(0, offset) + segment.slice(offset + statement.length)
        return new RegExp(`\\b${binding}\\s*(?:\\.|\\[|\\})`).test(withoutStatement) ? statement : ''
      },
    ))
    rewritten = rewritten.replace(/^\n{2,}/, '\n')
  }
  // Mintlify sources converted from Docusaurus keep its `<Tabs values>` and `<TabItem>`; a fenced example of them stays as written.
  if (runMintlify && rewritten.includes('<TabItem')) rewritten = replaceOutsideCode(rewritten, normalizeDocusaurusTabs)
  if (runMintlify) rewritten = normalizeMintlifyParameterAnchors(rewritten)
  rewritten = unwrapHtmlCommentInMdxComment(rewritten)
  rewritten = replaceOutsideCode(rewritten, (segment) => {
    let result = convertHtmlStyleAttributes(segment)
      .replace(/<!--([\s\S]*?)-->/g, (_match, content: string) => mdxComment(content))
      .replace(/<Danger(\s[^>]*)?>/g, '<Error$1>')
      .replace(/<\/Danger>/g, '</Error>')
      .replace(/<Warn(\s[^>]*)?>/g, '<Warning$1>')
      .replace(/<\/Warn>/g, '</Warning>')
      .replace(/<Tree\.Folder/g, '<Folder')
      .replace(/<\/Tree\.Folder>/g, '</Folder>')
      .replace(/<Tree\.File/g, '<File')
      .replace(/<\/Tree\.File>/g, '</File>')
    if (runDocusaurus) {
      result = normalizeDocusaurusLinkTags(normalizeStrayTabItems(result))
        // The repository adapter expands DocCardList from the resolved
        // sidebar after page discovery. Its source tag has no runtime peer.
        .replace(/<(?:DocCardList|TOCInline)\b[^<>]*\/>/g, '')
    }
    if (runMintlify) {
      result = normalizeMintlifyUpdateLabels(normalizeStrayTabItems(result))
        // Mintlify documents `<FileTree>` as a plain alias of `<Tree>`; Thally
        // only registers the latter.
        .replace(/<FileTree(\s[^>]*)?>/g, '<Tree$1>')
        .replace(/<\/FileTree>/g, '</Tree>')
        // Mintlify's `<GitHub.Repo repo="owner/name" />` is the same repository
        // card Thally already registers as `<GitHub repo="owner/name" />`.
        .replace(/<GitHub\.Repo/g, '<GitHub')
        .replace(/<\/GitHub\.Repo>/g, '</GitHub>')
        // Mintlify's `<Callout>` has no tone: it ignores a `type` prop and renders
        // a neutral box, which is Thally's info callout (an untyped one would take
        // a tone from its wording).
        .replace(/<Callout(\s[^<>]*)?>/g, (tag: string) => tag.replace(/(\s)type=(?:"[^"]*"|'[^']*'|\{[^{}]*\})/, '$1type="info"'))
        // `<Column>` is an unstyled wrapper for arbitrary content inside
        // `<Columns>`; Thally's grid already treats any direct child as a
        // column, so a plain `<div>` (built into MDX, no registry entry
        // needed) matches.
        .replace(/<Column(\s[^>]*)?>/g, '<div$1>')
        .replace(/<\/Column>/g, '</div>')
      // Mintlify renders step titles as plain text unless `titleSize` says
      // otherwise; Thally's default is an `<h3>`, so pin the source's default.
      result = pinStepsTitleSize(result)
      result = addMintlifyVideoAttributes(result)
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
  const normalized = escapeOrphanCapitalizedTags(provideScopedGlobalReferences(rewritten))
  if (runDocusaurus && sourceBody !== body) {
    try {
      compileSync(normalized, MDX_COMPILE_OPTIONS)
    } catch {
      // Some Docusaurus sites use this fence for imports or JSX fragments
      // whose surrounding source requires their private remark transforms.
      // Retain the original fenced page instead of dropping it entirely.
      return normalizeMdx(body, platform, false)
    }
  }
  return normalizeFlowParagraphContainers(separateBlockComponents(normalized))
}

/**
 * The root-relative `url` values that become a link: the whole value must match, nothing is rewritten.
 * - pathname: `/` and then plain segments (`[A-Za-z0-9._~-]+`) separated by single slashes, with an optional trailing slash;
 * - query (optional): `?` and plain `key=value` text, where `%` is only ever a valid `%XX` escape;
 * - fragment (optional): `#` and an element id (`[A-Za-z0-9._~-]+`).
 * Anything else (`//`, `:`, `+`, `*`, parentheses, braces, an encoded slash, `?q=https://x`) keeps the page as content:
 * Next.js reads path-to-regexp syntax in a redirect destination's pathname and fragment, reads `:name` in its query,
 * and collapses repeated slashes, so a value outside this grammar cannot be judged, or served, safely.
 */
const SITE_PATH_LINK = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\/?)?(?:\?(?:[A-Za-z0-9._~=&-]|%[0-9A-Fa-f]{2})*)?(?:#[A-Za-z0-9._~-]+)?$/
/** Next.js builds a redirect destination longer than 4096 characters into an error; the grammar's own values are far shorter. */
const MAX_SITE_PATH_LINK_LENGTH = 2000

/** The `url` as a link to a path of this site, or undefined when it is outside the grammar above. */
function sitePathLink(url: string): string | undefined {
  // `__ESC_` is Next.js's own escape marker: a destination holding it passes the build check and then fails when a request reaches it.
  if (url.length > MAX_SITE_PATH_LINK_LENGTH || url.includes('__ESC_') || !SITE_PATH_LINK.test(url)) return undefined
  return url.split(/[?#]/, 1)[0].split('/').some((segment) => segment === '.' || segment === '..') ? undefined : url
}

/**
 * A Mintlify page whose frontmatter `url` is a web address, or a path of its own site (`/local-development#turso-cli`),
 * is a link in the sidebar: visiting its path leaves for that address.
 */
function externalPageUrl(value: unknown): string | undefined {
  const url = typeof value === 'string' ? value.trim() : ''
  if (url.startsWith('/')) return sitePathLink(url)
  if (!/^https?:\/\/[^\s]+$/i.test(url)) return undefined
  try {
    new URL(url)
    return url
  } catch {
    return undefined
  }
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
  /** Receives a message when frontmatter is dropped or altered. */
  warn?: (message: string) => void
  /** The icon library the migrated site uses; a page icon naming another one is reported, and none is when omitted. */
  siteIconLibrary?: string
  /** The navigation label that titles a page with no title or heading of its own, before the file name does. */
  fallbackTitle?: string
}): MigrationPage | null {
  const parsed = parseFrontmatter(input.raw)
  if (input.platform === 'mintlify') {
    const supported = new Set([
      'title', 'description', 'sidebarTitle', 'navTitle', 'icon', 'iconType', 'tag', 'badge',
      'keywords', 'mode', 'hidden', 'noindex', 'url', 'openapi', 'api', 'authMethod', 'playground',
      // Access settings are enforced by the repository classifier, never lost here.
      'groups', 'public', ...PAGE_META_FIELDS.map(([field]) => field),
    ])
    const dropped = Object.keys(parsed.data).filter((key) => !supported.has(key))
    if (dropped.length) input.warn?.(`Unsupported Mintlify frontmatter fields were omitted: ${dropped.join(', ')}. Review their behavior before publishing.`)

  }
  const fallbackIdentity: MarkdownPageIdentity = {
    id: input.id,
    navigationId: input.navigationId ?? input.id,
    ...(input.locale ? { locale: input.locale } : {}),
  }
  const identity = input.resolveIdentity?.(parsed.data, fallbackIdentity) ?? fallbackIdentity
  const normalized = normalizeMdx(parsed.content, input.platform)
  const body = removeUndefinedExpressions(injectReactHookImports(input.platform === 'mintlify' ? normalizeMintlifyCodeFences(normalized, input.warn) : normalized), input.warn).trim()
  const keywords = Array.isArray(parsed.data.keywords)
    ? parsed.data.keywords.filter((value): value is string => typeof value === 'string')
    : []
  const namesOperation = typeof parsed.data.openapi === 'string' && Boolean(parsed.data.openapi.trim())
  // Mintlify titles a page from its frontmatter, else from its file name, and keeps a leading H1 in the body as an ordinary heading.
  // A page that names an operation keeps taking its heading as the title.
  const heading = input.platform === 'mintlify' && !namesOperation ? undefined : leadingPageHeading(body)
  const authoredTitle = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : heading?.title
  const title = authoredTitle ?? (input.fallbackTitle?.trim() || titleFromId(identity.navigationId))
  const sidebarTitle = input.platform === 'docusaurus' ? parsed.data.sidebar_label : parsed.data.sidebarTitle
  const navTitle = typeof sidebarTitle === 'string' && sidebarTitle.trim()
    ? sidebarTitle.trim()
    : typeof parsed.data.navTitle === 'string' && parsed.data.navTitle.trim()
      ? parsed.data.navTitle.trim()
      : undefined
  // Mintlify also writes the icon as `{ name, style, library }`.
  const iconObject = parsed.data.icon && typeof parsed.data.icon === 'object' && !Array.isArray(parsed.data.icon)
    ? parsed.data.icon as Record<string, unknown>
    : undefined
  const iconSource = iconObject ? iconObject.name : parsed.data.icon
  const icon = typeof iconSource === 'string' && iconSource.trim() ? iconSource.trim() : undefined
  const iconStyle = (value: unknown): MigrationPage['iconType'] =>
    typeof value === 'string' && ['regular', 'solid', 'outline', 'brands'].includes(value) ? value as MigrationPage['iconType'] : undefined
  const iconType = icon ? iconStyle(iconObject?.style) ?? iconStyle(parsed.data.iconType) : undefined
  // Thally has one icon library per site, so a page's own library only works when it is the site's.
  if (icon && typeof iconObject?.library === 'string' && input.siteIconLibrary !== undefined && iconObject.library !== input.siteIconLibrary) {
    input.warn?.(`Page "${identity.id}": its icon names the "${iconObject.library}" icon library, but this site uses "${input.siteIconLibrary}", so the icon "${icon}" is looked up there and may show a different icon or none. Use an icon name from "${input.siteIconLibrary}", or set icons.library in docs.json to "${iconObject.library}".`)
  }
  const meta: NonNullable<MigrationPage['meta']> = {}
  for (const [source, field] of PAGE_META_FIELDS) {
    const value = parsed.data[source]
    if (typeof value === 'string' && value.trim()) meta[field] = value.trim()
  }
  const badge = typeof parsed.data.tag === 'string' && parsed.data.tag.trim()
    ? parsed.data.tag.trim()
    : typeof parsed.data.badge === 'string' && parsed.data.badge.trim()
      ? parsed.data.badge.trim()
      : input.platform === 'fern' ? fernAvailabilityBadge(parsed.data.availability) : undefined
  const sourceMode = typeof parsed.data.mode === 'string' ? parsed.data.mode : undefined
  // Mintlify's frame mode and Thally's wide mode both retain the sidebar while
  // removing the on-page table of contents. Other shared modes map directly.
  const mode = sourceMode === 'frame'
    ? 'wide'
    : ['default', 'wide', 'custom', 'center', 'home'].includes(sourceMode ?? '')
      ? sourceMode as MigrationPage['mode']
      : undefined
  // A `url` that starts like a path of this site but is outside the grammar of `SITE_PATH_LINK` is reported; the page keeps its own content.
  if (input.platform === 'mintlify' && typeof parsed.data.url === 'string' && parsed.data.url.trim().startsWith('/') && !externalPageUrl(parsed.data.url)) {
    const shown = parsed.data.url.trim()
    input.warn?.(`Page "${identity.id}": its "url" frontmatter ${JSON.stringify(shown.length > 80 ? `${shown.slice(0, 80)}...` : shown)} was not turned into a link, so the page was kept with its own content. Only a site path made of letters, digits and . _ ~ - segments, with an optional ?key=value query and #id fragment, can become a link.`)
  }
  const externalUrl = input.platform === 'mintlify' ? externalPageUrl(parsed.data.url) : undefined
  const authoredDescription = typeof parsed.data.description === 'string' && parsed.data.description.trim() ? parsed.data.description.trim() : undefined
  // Fern shows `subtitle` as the lead line under the title. With no description of its own the page is described by it, which Thally
  // shows under the title; otherwise the description stays as it is and the subtitle opens the body.
  const subtitle = input.platform === 'fern' && typeof parsed.data.subtitle === 'string' && parsed.data.subtitle.trim()
    ? withoutMarkdownLinks(parsed.data.subtitle.trim()) : undefined
  const subtitleIsDescription = subtitle !== undefined && authoredDescription === undefined
  // An API reference page is described by its operation, not by its prose.
  const description = authoredDescription ?? (subtitleIsDescription ? subtitle : namesOperation ? '' : firstParagraph(body))
  const page: MigrationPage = {
    id: identity.id,
    navigationId: identity.navigationId,
    locale: identity.locale,
    title,
    ...(authoredTitle === undefined && namesOperation ? { titleFromFileName: true as const } : {}),
    navTitle,
    icon,
    iconType,
    description,
    // A description taken from the body is the paragraph the body already shows, so it must not also appear under the title.
    ...(!subtitleIsDescription && (input.platform === 'docusaurus' || input.platform === 'fern' || (authoredDescription === undefined && description !== ''))
      ? { descriptionPlacement: 'body' as const }
      : {}),
    badge,
    keywords,
    mode,
    hidden: parsed.data.hidden === true ? true : undefined,
    // The path of a page that links elsewhere redirects, so it has no business in a sitemap.
    noindex: parsed.data.noindex === true || parsed.data.noindex === 'true' || externalUrl ? true : undefined,
    ...(externalUrl ? { externalUrl } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    openapi: typeof parsed.data.openapi === 'string' ? parsed.data.openapi.trim() : undefined,
    ...apiFrontmatter(parsed.data, input.warn),
    body: subtitle !== undefined && !subtitleIsDescription
      ? `${subtitle.replace(/([\\{}<>])/g, '\\$1')}\n\n${body}`.trim()
      : body,
    source: input.source,
    ...(parsed.error ? { frontmatterError: parsed.error } : {}),
  }
  // Thally shows an authored description as plain text (with inline code), so the raw `[text](url)` of a link would be shown as typed.
  const writtenDescription = typeof parsed.data.description === 'string' ? parsed.data.description.trim() : ''
  const plainDescription = withoutMarkdownLinks(writtenDescription)
  if (plainDescription !== writtenDescription) {
    page.description = plainDescription
    input.warn?.(`Page "${identity.id}": its description had links, which Thally shows as plain text; the link text was kept.`)
  }
  resolvePageDisplayHeading(page, input.platform)
  return page
}

const PAGE_META_FIELDS = [
  ['og:title', 'ogTitle'],
  ['og:description', 'ogDescription'],
  ['og:image', 'ogImage'],
  ['twitter:title', 'twitterTitle'],
  ['twitter:description', 'twitterDescription'],
  ['twitter:image', 'twitterImage'],
] as const

const AUTH_METHODS = new Set(['bearer', 'basic', 'key', 'none'])

/** Carry manual-API frontmatter (`api`, `authMethod`) through; report what cannot be kept. */
function apiFrontmatter(
  data: Record<string, unknown>,
  warn?: (message: string) => void,
): Pick<MigrationPage, 'api' | 'authMethod' | 'playground'> {
  const result: Pick<MigrationPage, 'api' | 'authMethod' | 'playground'> = {}
  if (data.playground !== undefined && data.playground !== null) {
    const display = playgroundDisplay(data.playground, 'The page\'s "playground" frontmatter', warn)
    if (display) result.playground = display
  }
  if (data.api !== undefined && data.api !== null) {
    if (typeof data.api === 'string' && data.api.trim()) result.api = data.api.trim()
    else warn?.('The page\'s "api" frontmatter is not a "METHOD url-or-path" string and was dropped.')
  }
  if (data.authMethod !== undefined && data.authMethod !== null) {
    const method = typeof data.authMethod === 'string' ? data.authMethod.trim().toLowerCase() : ''
    if (AUTH_METHODS.has(method)) result.authMethod = method
    else warn?.('The page\'s "authMethod" frontmatter is not one of bearer, basic, key, none and was dropped.')
  }
  return result
}

/**
 * `body` with everything after its imports and exports wrapped in an element that carries `SOURCE_PAGE_ATTRIBUTE`, or undefined when
 * there is nothing to wrap or the page cannot take a wrapper: an export that follows the content cannot sit inside an element.
 */
export function wrapPageContent(body: string): string | undefined {
  let nodes: Array<MdxOffsetNode>
  try { nodes = (descriptionParser.parse(body) as MdxOffsetNode).children ?? [] } catch { return undefined }
  const first = nodes.findIndex((node) => node.type !== 'mdxjsEsm')
  const start = first < 0 ? undefined : nodes[first].position?.start.offset
  if (start === undefined || nodes.slice(first).some((node) => node.type === 'mdxjsEsm')) return undefined
  return `${body.slice(0, start)}<div ${SOURCE_PAGE_ATTRIBUTE}>\n\n${body.slice(start).trimEnd()}\n\n</div>\n`
}
