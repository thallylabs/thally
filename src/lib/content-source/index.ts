/**
 * ContentSource selection — which backend serves customer-authored content.
 *
 * `THALLY_CONTENT_SOURCE` (optional, default `filesystem`):
 *   - `filesystem` — content embedded by the build; OSS/self-host behavior,
 *     SSG preserved. This is the default and must stay byte-for-byte
 *     identical to the pre-ContentSource engine when the variable is unset.
 *   - `assets` — content read from the deployed Worker's static assets under
 *     `/_thally/content/…`, so a content-only publish (new assets, the build's
 *     Worker modules reused verbatim) goes live without a build. Doc routes
 *     read immutable content from each release. The documentation shell reads
 *     request policy so branding changes and downgrades apply without publishing
 *     another release; the content source itself remains release-scoped.
 *
 * Managed hosting sets the variable in the injected Worker bindings AND at
 * build time — `generateStaticParams` consults it during `next build`, so it
 * must be present then for doc routes to skip prerendering.
 *
 * Assets-mode documentation shells establish a request boundary through their
 * attribution resolver. That boundary must be visible at build time even though
 * the managed site snapshot is injected only when the Worker is deployed.
 * Filesystem-only, unlinked sites retain static generation.
 */

import type { ContentSource, ContentSourceKind } from './types'
import { filesystemContentSource } from './filesystem'
import { createAssetsContentSource } from './assets'

export type { ContentSource, ContentSourceFile, ContentSourceKind } from './types'
export { CONTENT_ASSET_PREFIX, CONTENT_MANIFEST_PATH, createAssetsContentSource } from './assets'
export type { ContentManifest, ContentManifestEntry } from './assets'
export { filesystemContentSource } from './filesystem'
export { getContentAssetFetcher, setContentAssetFetcher } from './runtime'
export type { ContentAssetFetcher } from './runtime'

let warnedUnknownKind = false

/**
 * Resolve the configured source kind. Unknown values resolve to `filesystem`
 * (the safe default — a typo must not blank a production site) with a single
 * warning so the misconfiguration is discoverable in logs.
 *
 * NOTE: middleware reads the same variable inline (see `src/middleware.ts`)
 * because this module's filesystem provider transitively imports `node:fs`,
 * which cannot be bundled into edge middleware.
 */
export function getContentSourceKind(): ContentSourceKind {
  const raw = process.env.THALLY_CONTENT_SOURCE?.trim().toLowerCase()
  if (!raw || raw === 'filesystem') return 'filesystem'
  if (raw === 'assets') return 'assets'
  if (!warnedUnknownKind) {
    warnedUnknownKind = true
    console.warn(
      `[thally] unknown THALLY_CONTENT_SOURCE "${raw}"; falling back to "filesystem".`,
    )
  }
  return 'filesystem'
}

/** True when content is served from deployment assets rather than the build. */
export function isRemoteContentSource(): boolean {
  return getContentSourceKind() === 'assets'
}

let cachedSource: ContentSource | null = null
let cachedKind: ContentSourceKind | null = null

/** The active ContentSource. Memoized per kind; the env cannot change mid-process. */
export function getContentSource(): ContentSource {
  const kind = getContentSourceKind()
  if (cachedSource && cachedKind === kind) return cachedSource
  cachedKind = kind
  cachedSource =
    kind === 'assets' ? createAssetsContentSource(filesystemContentSource) : filesystemContentSource
  return cachedSource
}

/** Clear process-local state between tests. */
export function resetContentSourceForTests(): void {
  cachedSource = null
  cachedKind = null
  warnedUnknownKind = false
}
