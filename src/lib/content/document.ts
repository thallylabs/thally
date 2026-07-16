/**
 * Runtime-aware adapter for the engine's canonical structured-content parser.
 *
 * Node builds and Cloudflare Workers must produce the same content graph. The
 * parser remains owned by `@thallylabs/core`; this adapter only supplies the
 * customer-authored bytes from disk in development or the generated source map
 * in workerd, where a project checkout is unavailable.
 */

import matter from 'gray-matter'
import { parseMdxContent, type ContentDocument } from '@thallylabs/core'
import {
  readRuntimeSource,
  runtimeSourceExists,
  runtimeSourceModifiedAt,
} from '@/lib/runtime-sources'

const CONTENT_ROOT = 'src/content'

function resolveContentFile(pageId: string, locale?: string): string | null {
  const candidates: Array<string> = []
  if (locale) {
    candidates.push(
      `${CONTENT_ROOT}/${locale}/${pageId}.mdx`,
      `${CONTENT_ROOT}/${locale}/${pageId}/index.mdx`,
    )
  }
  candidates.push(`${CONTENT_ROOT}/${pageId}.mdx`, `${CONTENT_ROOT}/${pageId}/index.mdx`)

  for (const filePath of candidates) {
    if (runtimeSourceExists(filePath)) return filePath
  }
  return null
}

// The build-observed mtime keeps the cache deterministic in both Node and
// workerd and lets development edits invalidate only their own document.
const documentCache = new Map<string, { modifiedAtMs: number; document: ContentDocument }>()

/** Read one page into the engine's single structured-content representation. */
export function getContentDocument(pageId: string, locale?: string): ContentDocument | null {
  const filePath = resolveContentFile(pageId, locale)
  if (!filePath) return null

  const modifiedAtMs = runtimeSourceModifiedAt(filePath)
  const cached = documentCache.get(filePath)
  if (cached?.modifiedAtMs === modifiedAtMs) return cached.document

  const raw = readRuntimeSource(filePath)
  const { data, content } = matter(raw)
  const document: ContentDocument = {
    pageId,
    frontmatter: data,
    rawBody: content,
    content: parseMdxContent(content),
  }

  documentCache.set(filePath, { modifiedAtMs, document })
  return document
}
