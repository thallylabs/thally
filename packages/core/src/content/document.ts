import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { parseMdxContent } from './parse.js'
import type { ParsedContent } from './types.js'

const CONTENT_ROOT = path.join(process.cwd(), 'src/content')

export interface ContentDocument {
  pageId: string
  frontmatter: Record<string, unknown>
  /** Raw markdown body with frontmatter removed. */
  rawBody: string
  content: ParsedContent
}

export type ContentDocumentResolver = (
  pageId: string,
  locale?: string,
) => ContentDocument | null

let registeredResolver: ContentDocumentResolver | null = null

/**
 * Register the host's runtime-aware content reader.
 *
 * The default filesystem reader keeps the framework-agnostic package useful
 * for local tools. Deployed hosts register a reader backed by their generated
 * source map so every projection consumes the same customer-authored bytes in
 * runtimes where the project checkout is unavailable.
 */
export function registerContentDocumentSource(resolver: ContentDocumentResolver): void {
  registeredResolver = resolver
}

function resolveContentFile(pageId: string, locale?: string): string | null {
  const candidates: Array<string> = []
  if (locale) {
    candidates.push(
      path.join(CONTENT_ROOT, locale, `${pageId}.mdx`),
      path.join(CONTENT_ROOT, locale, `${pageId}/index.mdx`),
    )
  }
  candidates.push(
    path.join(CONTENT_ROOT, `${pageId}.mdx`),
    path.join(CONTENT_ROOT, `${pageId}/index.mdx`),
  )

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath
  }
  return null
}

// Cache keyed by file path + mtime so unchanged files are parsed only once.
const documentCache = new Map<string, { mtimeMs: number; document: ContentDocument }>()

/**
 * Read and parse a content document into the typed content graph. This is the
 * single entry point the agent API, JSON-LD, search index, and (future)
 * embeddings should use — no ad-hoc regex extraction anywhere else.
 */
export function getContentDocument(pageId: string, locale?: string): ContentDocument | null {
  if (registeredResolver) return registeredResolver(pageId, locale)

  const filePath = resolveContentFile(pageId, locale)
  if (!filePath) return null

  const stat = fs.statSync(filePath)
  const cacheKey = filePath
  const cached = documentCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.document
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  const { data, content } = matter(raw)
  const document: ContentDocument = {
    pageId,
    frontmatter: data,
    rawBody: content,
    content: parseMdxContent(content),
  }

  documentCache.set(cacheKey, { mtimeMs: stat.mtimeMs, document })
  return document
}
