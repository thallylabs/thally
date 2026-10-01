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

  const webhook = /^(?:(.*?\S)\s+)?webhook\s+([^\s/]\S*)$/i.exec(trimmed)
  if (webhook) {
    const specRef = webhook[1] ? unquote(webhook[1]) : undefined
    return { specId: 'default', ...(specRef ? { specRef } : {}), method: 'WEBHOOK', path: webhook[2], webhook: true }
  }

  const operation = /^(?:(.*?\S)\s+)?([A-Za-z]+)\s+(\/.*)$/.exec(trimmed)
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

/** Path syntax is made uniform, but case survives except in a URL's scheme and host, which are case-insensitive. */
function canonicalRef(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, (origin) => origin.toLowerCase())
}

function baseName(value: string): string {
  return canonicalRef(value).split(/[?#]/, 1)[0].split('/').filter(Boolean).pop() ?? ''
}

function specLocation(spec: ApiSpecConfig): string | null {
  if (spec.source.type === 'file') return spec.source.path
  if (spec.source.type === 'url') return spec.source.url
  return null
}

/**
 * Resolve an authored spec prefix to a configured spec. A case-exact full
 * path/URL match wins, then a case-insensitive one; otherwise the file name
 * alone matches (migrated sites flatten specs to `/<file name>`), again exact
 * case first. Ties resolve to the first configured spec.
 */
export function findSpecForRef(specs: Array<ApiSpecConfig>, specRef: string): ApiSpecConfig | null {
  const wanted = canonicalRef(specRef)
  if (!wanted) return null
  const located = specs.flatMap((spec) => {
    const location = specLocation(spec)
    return location ? [{ spec, location }] : []
  })
  const wantedBase = baseName(specRef)
  const match =
    located.find(({ location }) => canonicalRef(location) === wanted)
    ?? located.find(({ location }) => canonicalRef(location).toLowerCase() === wanted.toLowerCase())
    ?? (wantedBase ? located.find(({ location }) => baseName(location) === wantedBase) : undefined)
    ?? (wantedBase ? located.find(({ location }) => baseName(location).toLowerCase() === wantedBase.toLowerCase()) : undefined)
  return match?.spec ?? null
}
