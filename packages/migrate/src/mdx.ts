/** Markdown/MDX normalization that preserves every component Thally supports. */

import matter from 'gray-matter'

import type { MigrationPage } from './types.js'

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

/** Normalize only syntax Thally cannot render; supported Mintlify JSX stays intact. */
export function normalizeMdx(body: string): string {
  return body
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
}): MigrationPage | null {
  const parsed = matter(input.raw)
  const body = normalizeMdx(parsed.content).trim()
  if (parsed.data.openapi && !body) return null
  const keywords = Array.isArray(parsed.data.keywords)
    ? parsed.data.keywords.filter((value): value is string => typeof value === 'string')
    : []
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
    ? parsed.data.title.trim()
    : titleFromId(input.navigationId ?? input.id)
  const description = typeof parsed.data.description === 'string' && parsed.data.description.trim()
    ? parsed.data.description.trim()
    : firstParagraph(body)
  return {
    id: input.id,
    navigationId: input.navigationId ?? input.id,
    locale: input.locale,
    title,
    description,
    keywords,
    body,
    source: input.source,
  }
}
