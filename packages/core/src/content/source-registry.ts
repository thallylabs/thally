/** Host-provided content document sources, isolated from filesystem fallback. */

import type { ContentDocument } from './document.js'

export type ContentDocumentResolver = (
  pageId: string,
  locale?: string,
) => ContentDocument | null

export type AsyncContentDocumentResolver = (
  pageId: string,
  locale?: string,
) => Promise<ContentDocument | null>

let registeredResolver: ContentDocumentResolver | null = null
let registeredAsyncResolver: AsyncContentDocumentResolver | null = null

/** Register the host's synchronous runtime-aware content reader. */
export function registerContentDocumentSource(resolver: ContentDocumentResolver): void {
  registeredResolver = resolver
}

/** Register a request-time reader for remote or asset-backed content. */
export function registerAsyncContentDocumentSource(
  resolver: AsyncContentDocumentResolver,
): void {
  registeredAsyncResolver = resolver
}

/** Internal lookup used by the filesystem-compatible document facade. */
export function resolveRegisteredContentDocument(
  pageId: string,
  locale?: string,
): ContentDocument | null | undefined {
  return registeredResolver?.(pageId, locale)
}

/** Internal async lookup used by the document facade. */
export function resolveRegisteredAsyncContentDocument(
  pageId: string,
  locale?: string,
): Promise<ContentDocument | null> | undefined {
  return registeredAsyncResolver?.(pageId, locale)
}
