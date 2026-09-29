/**
 * Parse a page's `openapi:` frontmatter and match its optional spec prefix
 * against the configured specs.
 *
 * Accepted forms (Mintlify-compatible):
 *   openapi: "GET /users"
 *   openapi: "openapi.json GET /users"
 *   openapi: "/path/to/spec.yaml GET /users"
 *   openapi: "openapi.json webhook orderUpdated"
 */

import type { ApiSpecConfig } from '@/lib/openapi/types'

export interface OpenApiFrontmatterRef {
  /** Legacy hint: the default spec is always tried first when no prefix is given. */
  specId: string
  /** Spec file/URL exactly as authored (unquoted); absent for the bare form. */
  specRef?: string
  method: string
  path: string
  /** True for the `webhook <name>` form; `path` then carries the webhook name. */
  webhook?: boolean
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function parseOpenApiFrontmatter(raw: unknown): OpenApiFrontmatterRef | null {
  if (typeof raw !== 'string') return null
  const trimmed = unquote(raw)
  if (!trimmed) return null

  const webhook = /^(?:(.+?)\s+)?webhook\s+([^\s/]\S*)$/i.exec(trimmed)
  if (webhook) {
    const specRef = webhook[1] ? unquote(webhook[1]) : undefined
    return { specId: 'default', ...(specRef ? { specRef } : {}), method: 'WEBHOOK', path: webhook[2], webhook: true }
  }

  const operation = /^(?:(.+?)\s+)?([A-Za-z]+)\s+(\/.*)$/.exec(trimmed)
  if (!operation) return null
  const specRef = operation[1] ? unquote(operation[1]) : undefined
  return {
    specId: 'default',
    ...(specRef ? { specRef } : {}),
    method: operation[2].toUpperCase(),
    // Historical behaviour: runs of whitespace inside the path collapse.
    path: operation[3].trim().split(/\s+/).join(' '),
  }
}

function normalizeRef(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').toLowerCase()
}

function baseName(value: string): string {
  return normalizeRef(value).split(/[?#]/, 1)[0].split('/').filter(Boolean).pop() ?? ''
}

function specLocation(spec: ApiSpecConfig): string | null {
  if (spec.source.type === 'file') return spec.source.path
  if (spec.source.type === 'url') return spec.source.url
  return null
}

/**
 * Resolve an authored spec prefix to a configured spec. A full path/URL match
 * wins; otherwise the file name alone matches (migrated sites flatten specs
 * to `/<file name>`). Ties resolve to the first configured spec.
 */
export function findSpecForRef(specs: Array<ApiSpecConfig>, specRef: string): ApiSpecConfig | null {
  const wanted = normalizeRef(specRef)
  if (!wanted) return null
  const located = specs.flatMap((spec) => {
    const location = specLocation(spec)
    return location ? [{ spec, location }] : []
  })
  const exact = located.find(({ location }) => normalizeRef(location) === wanted)
  if (exact) return exact.spec
  const wantedBase = baseName(specRef)
  if (!wantedBase) return null
  return located.find(({ location }) => baseName(location) === wantedBase)?.spec ?? null
}
