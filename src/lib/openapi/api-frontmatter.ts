/**
 * Parser-free half of manual API pages: docs.json `api.mdx` validation and the
 * `api:` frontmatter parser. The page index (docs.ts, page-api.ts) imports
 * these, so this module must never import the MDX parser that
 * `manual-operation.ts` needs for `<ParamField>` extraction.
 */

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
const AUTH_METHODS = new Set(['bearer', 'basic', 'key'])

export type Warn = (message: string) => void

export interface ApiMdxConfig {
  /** Valid, normalized (no trailing slash) base URLs from docs.json `api.mdx.server`. */
  servers: Array<string>
  auth?: { method: 'bearer' | 'basic' | 'key'; name?: string }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A base URL must be absolute http(s) without credentials, query or fragment. */
export function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash || !url.hostname) return null
  return trimmed.replace(/\/+$/, '')
}

/** Validate docs.json `api.mdx`; invalid parts are dropped with a warning. */
export function sanitizeApiMdxConfig(raw: unknown, warn: Warn = () => {}): ApiMdxConfig {
  const result: ApiMdxConfig = { servers: [] }
  if (raw === undefined || raw === null) return result
  if (!isPlainObject(raw)) {
    warn('docs.json "api.mdx" must be an object; ignoring it.')
    return result
  }
  const rawServers = raw.server === undefined ? [] : Array.isArray(raw.server) ? raw.server : [raw.server]
  for (const entry of rawServers) {
    const server = normalizeServerUrl(entry)
    if (server) {
      if (!result.servers.includes(server)) result.servers.push(server)
    } else {
      warn(`docs.json "api.mdx.server" entry ${JSON.stringify(entry)} is not an absolute http(s) URL without credentials, query or fragment; ignoring it.`)
    }
  }
  if (raw.auth !== undefined) {
    const auth = raw.auth
    const method = isPlainObject(auth) && typeof auth.method === 'string' ? auth.method.toLowerCase() : ''
    if (!isPlainObject(auth)) {
      warn('docs.json "api.mdx.auth" must be an object; ignoring it.')
    } else if (auth.method === undefined) {
      // Mintlify: omitted method means no authentication.
    } else if (!AUTH_METHODS.has(method)) {
      warn(`docs.json "api.mdx.auth.method" ${JSON.stringify(auth.method)} is not one of bearer, basic, key; ignoring it.`)
    } else {
      const name = typeof auth.name === 'string' && auth.name.trim() ? auth.name.trim() : undefined
      if (method === 'key' && !name) {
        warn('docs.json "api.mdx.auth" uses method "key" without a "name"; ignoring it.')
      } else {
        result.auth = { method: method as 'bearer' | 'basic' | 'key', ...(name ? { name } : {}) }
      }
    }
  }
  return result
}

export interface ManualApiTarget {
  method: string
  /** Origin (plus any base path is never included) when the value was an absolute URL. */
  server?: string
  path: string
  query: Record<string, string>
}

/** Parse `api: "METHOD https://host/path?x=1"` or `api: "METHOD /path"`. */
export function parseApiFrontmatter(raw: unknown, warn: Warn = () => {}): ManualApiTarget | null {
  if (typeof raw !== 'string') {
    warn(`"api" frontmatter must be a string like "POST https://api.example.com/users"; got ${Array.isArray(raw) ? 'a list' : typeof raw}.`)
    return null
  }
  const value = raw.trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
  const match = /^([A-Za-z]+)\s+(\S+)$/.exec(value)
  if (!match) {
    warn(`"api" frontmatter ${JSON.stringify(raw)} is not "METHOD url-or-path".`)
    return null
  }
  const method = match[1].toUpperCase()
  if (!METHODS.has(method)) {
    warn(`"api" frontmatter uses unsupported HTTP method "${match[1]}".`)
    return null
  }
  const target = match[2]
  const split = /^(https?:\/\/[^/?#]*)?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(target)
  if (!split || (!split[1] && !split[2].startsWith('/'))) {
    warn(`"api" frontmatter target ${JSON.stringify(target)} must be an absolute http(s) URL or a path starting with "/".`)
    return null
  }
  let server: string | undefined
  if (split[1]) {
    const origin = normalizeServerUrl(split[1])
    if (!origin || split[1].includes('@')) {
      warn(`"api" frontmatter URL ${JSON.stringify(target)} has an invalid host.`)
      return null
    }
    server = origin
  }
  const query: Record<string, string> = {}
  if (split[3]) {
    for (const [key, entry] of new URLSearchParams(split[3])) if (key) query[key] = entry
  }
  return { method, ...(server ? { server } : {}), path: split[2] || '/', query }
}

export { AUTH_METHODS }
