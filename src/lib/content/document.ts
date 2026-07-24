/**
 * Runtime-aware adapter for the engine's canonical structured-content parser.
 *
 * Node builds and Cloudflare Workers must produce the same content graph. The
 * parser remains owned by `@thallylabs/core`; this adapter only supplies the
 * customer-authored bytes — through the active ContentSource on the async
 * path (so managed publishes are visible without a build), or the embedded
 * source map on the legacy sync path.
 */

import matter from 'gray-matter'
import { parseMdxContent, type ContentDocument } from '@thallylabs/core'
import {
  readRuntimeSource,
  runtimeSourceExists,
  runtimeSourceModifiedAt,
} from '@/lib/runtime-sources'
import { getContentSource } from '@/lib/content-source'

const CONTENT_ROOT = 'src/content'

function contentFileCandidates(pageId: string, locale?: string): Array<string> {
  const candidates: Array<string> = []
  if (locale) {
    candidates.push(
      `${CONTENT_ROOT}/${locale}/${pageId}.mdx`,
      `${CONTENT_ROOT}/${locale}/${pageId}/index.mdx`,
    )
  }
  candidates.push(`${CONTENT_ROOT}/${pageId}.mdx`, `${CONTENT_ROOT}/${pageId}/index.mdx`)
  return candidates
}

function resolveContentFile(pageId: string, locale?: string): string | null {
  for (const filePath of contentFileCandidates(pageId, locale)) {
    if (runtimeSourceExists(filePath)) return filePath
  }
  return null
}

// The build-observed mtime keeps the cache deterministic in both Node and
// workerd and lets development edits invalidate only their own document. The
// cache key carries the origin ("embedded" vs the ContentSource kind) because
// the sync and async paths can read DIFFERENT bytes for the same file path
// under the assets source, and mtime equality alone must not conflate them.
const documentCache = new Map<string, { modifiedAtMs: number; document: ContentDocument }>()

function parseDocument(
  origin: string,
  pageId: string,
  filePath: string,
  raw: string,
  modifiedAtMs: number,
): ContentDocument {
  const cacheKey = `${origin}:${filePath}`
  const cached = documentCache.get(cacheKey)
  if (cached?.modifiedAtMs === modifiedAtMs) return cached.document

  const { data, content } = matter(raw)
  const document: ContentDocument = {
    pageId,
    frontmatter: data,
    rawBody: content,
    content: parseMdxContent(content),
  }

  documentCache.set(cacheKey, { modifiedAtMs, document })
  return document
}

/**
 * Read one page into the engine's single structured-content representation.
 *
 * Sync path over the build-embedded sources. Kept for callers that register
 * synchronous providers (search indexing, MCP tools, agent-readiness); under
 * the assets ContentSource these read build-time content until the next code
 * release — the publish pipeline re-indexes search out of band. Request-time
 * projections should prefer {@link loadContentDocument}.
 */
export function getContentDocument(pageId: string, locale?: string): ContentDocument | null {
  const filePath = resolveContentFile(pageId, locale)
  if (!filePath) return null
  return parseDocument('embedded', pageId, filePath, readRuntimeSource(filePath), runtimeSourceModifiedAt(filePath))
}

/**
 * Async twin of {@link getContentDocument} that reads through the active
 * ContentSource, so managed content publishes are reflected immediately.
 * Identical to the sync path under the default filesystem source.
 */
export async function loadContentDocument(
  pageId: string,
  locale?: string,
): Promise<ContentDocument | null> {
  const source = getContentSource()
  for (const filePath of contentFileCandidates(pageId, locale)) {
    const file = await source.read(filePath)
    if (file) return parseDocument(source.kind, pageId, filePath, file.content, file.modifiedAtMs)
  }
  return null
}
