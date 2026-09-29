/**
 * Find OpenAPI documents under `public/`. The host serves that directory
 * verbatim, so any spec left there is downloadable regardless of the
 * publication filter that drops excluded / hidden operations.
 */

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'

const OPENAPI_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']
const SPEC_EXTENSIONS = /\.(?:json|ya?ml)$/i
const MAX_SPEC_BYTES = 10_000_000
const MAX_DEPTH = 8
const MAX_ENTRIES = 5000

const isFlagged = (value: unknown) => value === true || value === 'true'

/** True when the spec marks any operation/path entry/path item/webhook hidden or excluded (extensions or docs.json overrides). */
export function specHasHiddenOperations(spec: Record<string, unknown>, overrides?: unknown): boolean {
  if (overrides && typeof overrides === 'object' &&
    Object.values(overrides).some((o) => (o as { hidden?: unknown } | null)?.hidden === true)) return true
  const components = spec.components as { pathItems?: unknown } | undefined
  for (const group of [spec.paths, spec.webhooks, spec['x-webhooks'], components?.pathItems]) {
    if (!group || typeof group !== 'object') continue
    for (const item of Object.values(group as Record<string, unknown>)) {
      if (!item || typeof item !== 'object') continue
      // The entry itself covers flags written next to a `$ref`.
      const record = item as Record<string, unknown>
      if (isFlagged(record['x-excluded']) || isFlagged(record['x-hidden'])) return true
      for (const method of OPENAPI_METHODS) {
        const op = record[method] as Record<string, unknown> | undefined
        if (op && typeof op === 'object' && (isFlagged(op['x-excluded']) || isFlagged(op['x-hidden']))) return true
      }
    }
  }
  return false
}

export interface PublicSpecFile {
  /** Project-relative path, forward slashes (e.g. `public/openapi.json`). */
  path: string
  /** Path below `public/`, i.e. the URL path without the leading slash. */
  urlPath: string
  hasHiddenOperations: boolean
}

export interface PublicSpecScan {
  specs: Array<PublicSpecFile>
  /** Spec-looking files that were too large to inspect. */
  skipped: Array<string>
}

/** Every `.json` / `.yaml` / `.yml` under `public/` whose top level has `openapi` or `swagger`. Bounded and read-only. */
export function findPublicSpecs(projectDir: string): PublicSpecScan {
  const publicDir = join(projectDir, 'public')
  const scan: PublicSpecScan = { specs: [], skipped: [] }
  let seen = 0
  const walk = (dir: string, depth: number): void => {
    let entries: Array<string>
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return
      const full = join(dir, entry)
      let stat
      try {
        stat = lstatSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        if (depth < MAX_DEPTH && entry !== 'node_modules') walk(full, depth + 1)
        continue
      }
      if (!stat.isFile() || !SPEC_EXTENSIONS.test(entry)) continue
      const urlPath = relative(publicDir, full).split(/[\\/]/).join('/')
      if (stat.size > MAX_SPEC_BYTES) {
        scan.skipped.push(`public/${urlPath}`)
        continue
      }
      try {
        const raw = readFileSync(full, 'utf8')
        const parsed = /\.json$/i.test(entry) ? JSON.parse(raw) : parseYaml(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        const spec = parsed as Record<string, unknown>
        if (typeof spec.openapi !== 'string' && typeof spec.swagger !== 'string') continue
        scan.specs.push({ path: `public/${urlPath}`, urlPath, hasHiddenOperations: specHasHiddenOperations(spec) })
      } catch {
        // Not parseable: not a spec the host would present as one.
      }
    }
  }
  walk(publicDir, 0)
  return scan
}
