/**
 * Release-aware access to the repository's docs.json configuration.
 *
 * Self-hosted builds use the checked-in file. Managed releases may replace
 * that snapshot with the bounded `THALLY_DOCS_CONFIG` text binding, allowing
 * navigation and presentation settings to change without recompiling the
 * Worker. The binding is deployment-scoped rather than request-scoped, so it
 * is safe to memoize by its immutable raw value inside one Worker isolate.
 */

import repositoryDocsConfig from '../../docs.json' assert { type: 'json' }

const MAX_DOCS_CONFIG_BINDING_BYTES = 5 * 1_024

type DocsJsonObject = Record<string, unknown> & { tabs: Array<unknown> }

const repositoryConfig = repositoryDocsConfig as DocsJsonObject
let hasResolvedBinding = false
let resolvedRaw: string | undefined
let resolvedConfig: DocsJsonObject = repositoryConfig
let resolvedRevision = 0

function isDocsJsonObject(value: unknown): value is DocsJsonObject {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { tabs?: unknown }).tabs)
  )
}

function bindingValue(): string | undefined {
  return (process.env.THALLY_DOCS_CONFIG ?? process.env.DOX_DOCS_CONFIG)?.trim() || undefined
}

function parseBinding(raw: string): DocsJsonObject | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_DOCS_CONFIG_BINDING_BYTES) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return isDocsJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Resolve the active release configuration, falling back without throwing. */
export function getDocsJsonConfig<T extends object = DocsJsonObject>(): T {
  const raw = bindingValue()
  if (hasResolvedBinding && raw === resolvedRaw) return resolvedConfig as T

  hasResolvedBinding = true
  resolvedRaw = raw
  resolvedRevision += 1
  if (!raw) {
    resolvedConfig = repositoryConfig
    return resolvedConfig as T
  }

  const parsed = parseBinding(raw)
  if (!parsed) {
    console.warn('THALLY_DOCS_CONFIG is malformed; using the compiled docs.json.')
    resolvedConfig = repositoryConfig
    return resolvedConfig as T
  }
  resolvedConfig = parsed
  return resolvedConfig as T
}

/** Monotonic identity used to invalidate config-derived in-memory caches. */
export function getDocsJsonConfigRevision(): number {
  getDocsJsonConfig()
  return resolvedRevision
}

/** Test hook for binding/fallback coverage without leaking state across cases. */
export function resetDocsJsonConfigForTests(): void {
  hasResolvedBinding = false
  resolvedRaw = undefined
  resolvedConfig = repositoryConfig
  resolvedRevision += 1
}
