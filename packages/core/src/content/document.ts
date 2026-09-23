/**
 * Canonical content-document readers for filesystem and host-provided stores.
 *
 * The synchronous resolver preserves local/self-hosted compatibility while
 * the async resolver lets managed runtimes read immutable content assets.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import { parseMdxContent } from './parse.js'
import {
  resolveRegisteredAsyncContentDocument,
  resolveRegisteredContentDocument,
} from './source-registry.js'
import type { ParsedContent } from './types.js'

// Keep the historical document-module imports working for package-internal
// consumers while the public `registry` subpath provides the lean host API.
export {
  registerAsyncContentDocumentSource,
  registerContentDocumentSource,
} from './source-registry.js'

const CONTENT_ROOT = path.join(process.cwd(), 'src/content')

export interface ContentDocument {
  pageId: string
  frontmatter: Record<string, unknown>
  /** Raw markdown body with frontmatter removed. */
  rawBody: string
  content: ParsedContent
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
    // Deployed hosts register an embedded/asset reader before search runs.
    // This fallback is for local Node tools only; tracing a dynamic absolute
    // path would otherwise package the entire repository into server output.
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) return filePath
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
  const registered = resolveRegisteredContentDocument(pageId, locale)
  if (registered !== undefined) return registered

  const filePath = resolveContentFile(pageId, locale)
  if (!filePath) return null

  const stat = fs.statSync(/*turbopackIgnore: true*/ filePath)
  const cacheKey = filePath
  const cached = documentCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.document
  }

  const raw = fs.readFileSync(/*turbopackIgnore: true*/ filePath, 'utf8')
  const { data, content } = parseFrontmatter(raw)
  const document: ContentDocument = {
    pageId,
    frontmatter: data,
    rawBody: content,
    // ContentDocument is the machine-readable projection consumed by search,
    // embeddings, and agent APIs, so it intentionally selects agent content.
    content: parseMdxContent(content, 'agents'),
  }

  documentCache.set(cacheKey, { mtimeMs: stat.mtimeMs, document })
  return document
}

/** Async reader for remote content, falling back to the synchronous provider. */
export async function loadContentDocument(
  pageId: string,
  locale?: string,
): Promise<ContentDocument | null> {
  const registered = resolveRegisteredAsyncContentDocument(pageId, locale)
  if (registered) return registered
  return getContentDocument(pageId, locale)
}
