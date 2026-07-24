/** Markdown/MDX normalization that preserves every component Thally supports. */

import matter from 'gray-matter'

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

function firstParagraph(content: string): string {
  for (const block of content.split(/\n\s*\n/)) {
    const value = block.replace(/\s+/g, ' ').trim()
    if (!value || /^(?:#|```|:::|<|import\s|export\s)/.test(value)) continue
    return value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 240)
  }
  return ''
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

/** Normalize only syntax Thally cannot render; supported source JSX stays intact. */
export function normalizeMdx(body: string): string {
  return normalizeDocusaurusAdmonitions(body)
    // Docusaurus injects these theme components globally. Thally also exposes
    // its equivalents globally, so source-only imports must not survive.
    .replace(/^import\s+(?:Tabs|TabItem|Link|DocCardList|TOCInline)\s+from\s+['"]@(?:theme|docusaurus)\/[^'"]+['"]\s*;?\s*$/gm, '')
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
    .replace(/<Check(\s[^>]*)?>/g, '<Note$1>')
    .replace(/<\/Check>/g, '</Note>')
    .replace(/<Tree\.Folder/g, '<Folder')
    .replace(/<\/Tree\.Folder>/g, '</Folder>')
    .replace(/<Tree\.File/g, '<File')
    .replace(/<\/Tree\.File>/g, '</File>')
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
  const parsed = matter(input.raw)
  const fallbackIdentity: MarkdownPageIdentity = {
    id: input.id,
    navigationId: input.navigationId ?? input.id,
    ...(input.locale ? { locale: input.locale } : {}),
  }
  const identity = input.resolveIdentity?.(parsed.data, fallbackIdentity) ?? fallbackIdentity
  const body = normalizeMdx(parsed.content).trim()
  const keywords = Array.isArray(parsed.data.keywords)
    ? parsed.data.keywords.filter((value): value is string => typeof value === 'string')
    : []
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
    ? parsed.data.title.trim()
    : titleFromId(identity.navigationId)
  const description = typeof parsed.data.description === 'string' && parsed.data.description.trim()
    ? parsed.data.description.trim()
    : firstParagraph(body)
  return {
    id: identity.id,
    navigationId: identity.navigationId,
    locale: identity.locale,
    title,
    description,
    keywords,
    openapi: typeof parsed.data.openapi === 'string' ? parsed.data.openapi.trim() : undefined,
    body,
    source: input.source,
  }
}
