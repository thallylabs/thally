/**
 * Runtime content index — frontmatter and enumeration without the bundle.
 *
 * Managed hosting injects `THALLY_CONTENT_INDEX` as a plain-text Worker
 * binding: one JSON object mapping every content file the release serves to
 * its parsed frontmatter and modification time. It exists so the projections
 * *about* content — navigation labels, page enumeration, sitemap, llms.txt —
 * can describe the content actually being served rather than whatever was
 * compiled into this bundle. Page bodies are not in the index; they resolve
 * through the ContentSource.
 *
 * When the binding is present it is authoritative: a page missing from the
 * index does not exist, even if the compiled bundle carries it. Falling back
 * per-page would resurrect the bundle's pages on a site whose content has
 * diverged from it, which is precisely the failure this index prevents.
 * When the binding is absent (self-hosted, filesystem builds, or any managed
 * release predating it) every reader keeps the compiled behaviour, byte for
 * byte.
 *
 * Reads happen at module scope. workerd populates `process.env` from text
 * bindings before top-level module evaluation (verified empirically; a
 * 163 KiB index parses in ~4 ms), so this is deliberately synchronous — the
 * consumers (`src/data/docs.ts`, `src/lib/runtime-sources.ts`) run during
 * module initialisation and cannot await.
 *
 * Large managed sites exceed the platform's small plain-text binding budget.
 * Request-time consumers use {@link loadContentIndex}, which preserves this
 * synchronous fast path and otherwise reads the same index from ASSETS.
 */

import { getContentAssetFetcher } from '@/lib/content-source/runtime'

interface ContentIndexEntry {
  /** Parsed frontmatter, exactly as gray-matter returned it at publish time. */
  data: Record<string, unknown>
  /** Publish-observed modification time; drives translation staleness only. */
  modifiedAtMs: number
}

export interface ContentIndex {
  version: 1
  pages: Record<string, ContentIndexEntry>
}

/** Immutable release index emitted alongside the authored content assets. */
export const CONTENT_INDEX_ASSET_PATH = '/_thally/content/index.json'

/**
 * Only paths under these roots are ever indexed, so only these roots defer to
 * the index. Everything else (public assets, OpenAPI specs, AGENTS.md) keeps
 * the compiled source map regardless of the binding.
 */
const INDEXED_PREFIXES = ['src/content/', 'snippets/'] as const

let resolved: ContentIndex | null | undefined
let assetIndexPromise: Promise<ContentIndex | null> | null = null

function parseContentIndex(raw: string): ContentIndex | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as { version?: unknown; pages?: unknown }
    if (candidate.version !== 1) return null
    if (
      !candidate.pages ||
      typeof candidate.pages !== 'object' ||
      Array.isArray(candidate.pages)
    ) {
      return null
    }
    const pages: Record<string, ContentIndexEntry> = {}
    for (const [key, value] of Object.entries(candidate.pages)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      const entry = value as { data?: unknown; modifiedAtMs?: unknown }
      if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
        return null
      }
      pages[key] = {
        data: entry.data as Record<string, unknown>,
        modifiedAtMs:
          typeof entry.modifiedAtMs === 'number' && Number.isFinite(entry.modifiedAtMs)
            ? entry.modifiedAtMs
            : 0,
      }
    }
    return { version: 1, pages }
  } catch {
    return null
  }
}

/**
 * The active content index, or null when the release does not carry one.
 *
 * Malformed JSON degrades to null (compiled behaviour) with a warning rather
 * than throwing: the binding is produced by the publish pipeline, and a bad
 * index must never take a serving site down when the compiled map still can
 * answer.
 */
export function getContentIndex(): ContentIndex | null {
  if (resolved !== undefined) return resolved
  const raw = process.env.THALLY_CONTENT_INDEX?.trim()
  if (!raw) {
    resolved = null
    return resolved
  }
  resolved = parseContentIndex(raw)
  if (resolved === null) {
    console.warn('THALLY_CONTENT_INDEX is malformed; using the compiled content map.')
  }
  return resolved
}

/**
 * Load the release content index, using the text binding when it fits and the
 * immutable ASSETS copy for larger sites. Failures return null so callers can
 * retain their compiled/self-hosted fallback instead of taking the site down.
 */
export function loadContentIndex(): Promise<ContentIndex | null> {
  const inline = getContentIndex()
  if (inline) return Promise.resolve(inline)
  if (assetIndexPromise) return assetIndexPromise
  const fetchAsset = getContentAssetFetcher()
  if (!fetchAsset) return Promise.resolve(null)
  assetIndexPromise = (async () => {
    try {
      const response = await fetchAsset(CONTENT_INDEX_ASSET_PATH)
      if (!response.ok) return null
      const parsed = parseContentIndex(await response.text())
      // The synchronous readers that build navigation and page metadata run
      // after the request entry point has awaited this loader. Seed their
      // cache with the same immutable release index so they never fall back
      // to slug-derived labels merely because the index exceeded a binding.
      if (parsed) resolved = parsed
      return parsed
    } catch {
      assetIndexPromise = null
      return null
    }
  })()
  return assetIndexPromise
}

/** Whether index-present releases answer for this project-relative path. */
export function isIndexedContentPath(projectPath: string): boolean {
  return INDEXED_PREFIXES.some((prefix) => projectPath.startsWith(prefix))
}

/** Test hook mirroring `resetDocsJsonConfigForTests`. */
export function resetContentIndexForTests(): void {
  resolved = undefined
  assetIndexPromise = null
}
