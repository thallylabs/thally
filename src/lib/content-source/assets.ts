/**
 * The managed-runtime ContentSource: content served from the deployed
 * Worker's own static assets.
 *
 * A content publish uploads customer files under a reserved asset prefix and
 * a manifest listing them, reusing the previous release's Worker modules.
 * Because assets are immutable per deployment (a publish mints a new script),
 * everything here may be cached for the isolate's lifetime.
 *
 * Layout (the contract the publish pipeline must produce):
 *   /_thally/content/manifest.json                 — ContentManifest (below)
 *   /_thally/content/<project-relative-path>       — file bytes, verbatim
 * e.g. /_thally/content/src/content/introduction.mdx
 *
 * Failure contract: this source must never take a site down. When the assets
 * binding is missing or the manifest cannot be loaded, every operation falls
 * back to the embedded filesystem source, so a misconfigured deployment
 * serves its build-time content instead of 404s.
 */

import type { ContentSource, ContentSourceFile } from './types'
import { getContentAssetFetcher, type ContentAssetFetcher } from './runtime'

/** Reserved asset prefix for published content. Shared with the publish pipeline. */
export const CONTENT_ASSET_PREFIX = '/_thally/content/'

/** Manifest asset path. One fetch answers exists/list/modifiedAt for the release. */
export const CONTENT_MANIFEST_PATH = `${CONTENT_ASSET_PREFIX}manifest.json`

export interface ContentManifestEntry {
  /** Publish-observed modification time (e.g. commit timestamp). */
  modifiedAtMs?: number
}

export interface ContentManifest {
  version: 1
  /** Project-relative POSIX path → metadata, for every published content file. */
  files: Record<string, ContentManifestEntry>
}

function isContentManifest(value: unknown): value is ContentManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<ContentManifest>
  return manifest.version === 1 && typeof manifest.files === 'object' && manifest.files !== null
}

/**
 * Reject absolute or traversing paths before they reach a URL. The asset
 * namespace mirrors project-relative paths only; anything else is hostile or
 * a bug.
 */
function isSafeProjectPath(projectPath: string): boolean {
  if (!projectPath || projectPath.startsWith('/')) return false
  return projectPath.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function assetUrlPath(projectPath: string): string {
  // Encode each segment (not the slashes) so file names with spaces or
  // unicode round-trip through the asset URL space.
  return CONTENT_ASSET_PREFIX + projectPath.split('/').map(encodeURIComponent).join('/')
}

export function createAssetsContentSource(
  fallback: ContentSource,
  resolveFetcher: () => ContentAssetFetcher | null = getContentAssetFetcher,
): ContentSource {
  // Isolate-lifetime caches — safe because a publish deploys a new script.
  let manifestPromise: Promise<ContentManifest | null> | null = null
  const filePromises = new Map<string, Promise<ContentSourceFile | null>>()
  let warnedUnavailable = false

  function warnFallbackOnce(reason: string): void {
    if (warnedUnavailable) return
    warnedUnavailable = true
    console.warn(
      `[thally] content source "assets" is unavailable (${reason}); falling back to build-embedded content.`,
    )
  }

  /**
   * Load the manifest once per isolate. A missing fetcher is not cached as a
   * failure — the Cloudflare context may simply not exist yet — but a fetched
   * failure is, to avoid hammering a broken deployment on every read.
   */
  function loadManifest(): Promise<ContentManifest | null> {
    const fetchAsset = resolveFetcher()
    if (!fetchAsset) {
      warnFallbackOnce('no assets fetcher')
      return Promise.resolve(null)
    }
    if (!manifestPromise) {
      manifestPromise = (async () => {
        let response: Response
        try {
          response = await fetchAsset(CONTENT_MANIFEST_PATH)
        } catch (error) {
          // A thrown fetch is transient: fall back for this read but clear
          // the cached attempt so the next read retries instead of pinning
          // the whole isolate to embedded content.
          manifestPromise = null
          warnFallbackOnce(error instanceof Error ? error.message : 'manifest fetch failed')
          return null
        }
        // A served-but-unusable manifest (missing, or malformed JSON) is a
        // deployment defect a retry cannot fix — cache the failure so a
        // broken release does not hammer the asset host on every read.
        if (!response.ok) {
          warnFallbackOnce(`manifest fetch returned ${response.status}`)
          return null
        }
        try {
          const parsed: unknown = await response.json()
          if (!isContentManifest(parsed)) {
            warnFallbackOnce('manifest is malformed')
            return null
          }
          return parsed
        } catch {
          warnFallbackOnce('manifest is malformed')
          return null
        }
      })()
    }
    return manifestPromise
  }

  function readAsset(projectPath: string, manifest: ContentManifest): Promise<ContentSourceFile | null> {
    let pending = filePromises.get(projectPath)
    if (!pending) {
      pending = (async () => {
        const fetchAsset = resolveFetcher()
        if (!fetchAsset) return fallback.read(projectPath)
        try {
          const response = await fetchAsset(assetUrlPath(projectPath))
          if (!response.ok) {
            // The manifest promised this file; a miss means the asset set and
            // manifest disagree. Surface it as missing rather than guessing.
            console.warn(`[thally] published content asset missing: ${projectPath} (${response.status})`)
            return null
          }
          return {
            content: await response.text(),
            modifiedAtMs: manifest.files[projectPath]?.modifiedAtMs ?? 0,
          }
        } catch (error) {
          console.warn(
            `[thally] published content asset read failed: ${projectPath} (${
              error instanceof Error ? error.message : 'fetch failed'
            })`,
          )
          return null
        }
      })()
      filePromises.set(projectPath, pending)
      // Only successful reads may cache for the isolate lifetime — a
      // transient fetch failure must not pin a page to "missing" until the
      // isolate recycles.
      void pending.then((file) => {
        if (file === null) filePromises.delete(projectPath)
      })
    }
    return pending
  }

  return {
    kind: 'assets',

    async exists(projectPath: string): Promise<boolean> {
      if (!isSafeProjectPath(projectPath)) return false
      const manifest = await loadManifest()
      if (!manifest) return fallback.exists(projectPath)
      return Object.prototype.hasOwnProperty.call(manifest.files, projectPath)
    },

    async read(projectPath: string): Promise<ContentSourceFile | null> {
      if (!isSafeProjectPath(projectPath)) return null
      const manifest = await loadManifest()
      if (!manifest) return fallback.read(projectPath)
      if (!Object.prototype.hasOwnProperty.call(manifest.files, projectPath)) return null
      return readAsset(projectPath, manifest)
    },

    async modifiedAt(projectPath: string): Promise<number> {
      if (!isSafeProjectPath(projectPath)) return 0
      const manifest = await loadManifest()
      if (!manifest) return fallback.modifiedAt(projectPath)
      return manifest.files[projectPath]?.modifiedAtMs ?? 0
    },

    async list(prefix: string): Promise<Array<string>> {
      const manifest = await loadManifest()
      if (!manifest) return fallback.list(prefix)
      const normalizedPrefix = `${prefix.replace(/\/+$/, '')}/`
      return Object.keys(manifest.files).filter((key) => key.startsWith(normalizedPrefix))
    },
  }
}
