/** Markdown/MDX normalization that preserves every component Thally supports. */

import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

import { parseFrontmatter } from './frontmatter.js'
import type { MigrationPage } from './types.js'

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

/** Normalize only syntax Thally cannot render; supported source JSX stays intact. */
export function normalizeMdx(body: string): string {
  // Docusaurus injects these theme components globally. Thally also exposes
  // its equivalents globally, so source-only imports must not survive.
  const withoutGlobalImports = body
    .split('\n')
    .filter((line) => !isGlobalDocusaurusImport(line))
    .join('\n')
  return normalizeDocusaurusAdmonitions(normalizeNestedCodeFences(withoutGlobalImports))
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
}

const REACT_HOOK_NAMES = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer']

/**
 * Mintlify documents these seven hooks as pre-injected globals for a page's
 * inline `export const Widget = () => {...}` components. Thally's MDX
 * pipeline only resolves registered components inside the page body itself,
 * not inside such hand-authored functions, so a bare hook call there is an
 * undefined reference at render time. Importing whichever hooks the page
 * actually calls restores the same authoring experience with no custom
 * compiler step.
 */
function injectReactHookImports(body: string): string {
  const used = REACT_HOOK_NAMES.filter((hook) => (
    new RegExp(`\\b${hook}\\s*\\(`).test(body)
    && !new RegExp(`import\\s*\\{[^}]*\\b${hook}\\b[^}]*\\}\\s*from\\s*['"]react['"]`).test(body)
  ))
  return used.length > 0 ? `import { ${used.join(', ')} } from 'react'\n\n${body}` : body
}

/** Parse source Markdown or MDX into the canonical page representation. */
export function parseMarkdownPage(input: {
  id: string
  navigationId?: string
  locale?: string
  raw: string
  source: string
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
  const body = injectReactHookImports(normalizeMdx(parsed.content)).trim()
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
