/**
 * Manual API pages: `api: "METHOD <url-or-path>"` frontmatter plus the page's
 * own `<ParamField>` elements become a synthetic operation that the existing
 * endpoint header and Try It playground render.
 *
 * Trust boundary: everything here derives from site-owner content (page
 * frontmatter, MDX source, docs.json). The Try It relay re-derives the same
 * operation server-side from the page id, so the browser never supplies a
 * target authority.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkMdx from 'remark-mdx'
import type { NormalizedOperation, OperationPrefill } from '@/lib/openapi/types'

export const MANUAL_SPEC_ID = 'manual'
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

type ParamLocation = 'path' | 'query' | 'header' | 'body'

export interface ParamFieldSpec {
  location: ParamLocation
  name: string
  type?: string
  required: boolean
  default?: string
  placeholder?: string
}

interface MdxAttribute {
  type: string
  name?: string
  value?: string | null | { value?: string }
}

interface MdxNode {
  type: string
  name?: string | null
  attributes?: Array<MdxAttribute>
  children?: Array<MdxNode>
}

function attributeValue(attribute: MdxAttribute | undefined): string | boolean | undefined {
  if (!attribute) return undefined
  const value = attribute.value
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value
  const expression = (value.value ?? '').trim()
  try {
    const parsed: unknown = JSON.parse(expression)
    if (typeof parsed === 'string' || typeof parsed === 'boolean') return parsed
    if (typeof parsed === 'number') return String(parsed)
    return expression
  } catch {
    return expression
  }
}

/** Collect `<ParamField>` elements from MDX source; unparsable MDX yields none. */
export function extractParamFields(mdx: string, warn: Warn = () => {}): Array<ParamFieldSpec> {
  let tree: MdxNode
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(mdx) as unknown as MdxNode
  } catch {
    warn('Could not parse the page MDX to read its ParamField elements; the playground will have no parameters.')
    return []
  }
  const fields: Array<ParamFieldSpec> = []
  const seen = new Set<string>()
  const visit = (node: MdxNode) => {
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'ParamField') {
      const attrs = new Map<string, MdxAttribute>()
      for (const attribute of node.attributes ?? []) {
        if (attribute.type === 'mdxJsxAttribute' && attribute.name) attrs.set(attribute.name, attribute)
      }
      // Same precedence as the rendered <ParamField>: path, query, header, body.
      const located = (['path', 'query', 'header', 'body'] as const).find((key) => {
        const value = attributeValue(attrs.get(key))
        return value !== undefined && value !== false && value !== 'false'
      })
      const locatedName = located ? attributeValue(attrs.get(located)) : undefined
      const explicit = attributeValue(attrs.get('name'))
      const name = typeof locatedName === 'string' && locatedName ? locatedName
        : typeof explicit === 'string' && explicit ? explicit
          : ''
      const location: ParamLocation = located ?? 'body'
      if (!name) {
        warn('A <ParamField> without a name was skipped in the playground.')
      } else if (seen.has(`${location}:${name}`)) {
        warn(`Duplicate <ParamField ${location}="${name}"> ignored in the playground; the first one wins.`)
      } else {
        seen.add(`${location}:${name}`)
        const type = attributeValue(attrs.get('type'))
        const def = attributeValue(attrs.get('default'))
        const placeholder = attributeValue(attrs.get('placeholder'))
        const required = attributeValue(attrs.get('required'))
        fields.push({
          location,
          name,
          ...(typeof type === 'string' && type ? { type } : {}),
          required: required === true || required === 'true',
          ...(def !== undefined ? { default: String(def) } : {}),
          ...(typeof placeholder === 'string' ? { placeholder } : {}),
        })
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return fields
}

function bodyLeaf(field: ParamFieldSpec): unknown {
  const type = (field.type ?? 'string').toLowerCase()
  const raw = field.default
  if (/^(integer|int|number|float|double)$/.test(type)) {
    const parsed = raw === undefined ? NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (type === 'boolean' || type === 'bool') return raw === 'true'
  if (type === 'object' || type === 'array' || type.endsWith('[]') || type.startsWith('array')) {
    if (raw !== undefined) {
      try {
        return JSON.parse(raw)
      } catch {
        // fall through to an empty container
      }
    }
    return type === 'object' ? {} : []
  }
  return raw ?? ''
}

/** Build the JSON body: dotted names (`user.name`) nest; flat names stay flat. */
export function buildManualBody(fields: Array<ParamFieldSpec>): string | undefined {
  const bodyFields = fields.filter((field) => field.location === 'body')
  if (bodyFields.length === 0) return undefined
  const root: Record<string, unknown> = {}
  for (const field of bodyFields) {
    const parts = field.name.split('.').filter(Boolean)
    if (parts.length === 0 || parts.some((part) => part === '__proto__' || part === 'constructor' || part === 'prototype')) continue
    let cursor = root
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part]
      if (!isPlainObject(next)) cursor[part] = Object.create(null) as Record<string, unknown>
      cursor = cursor[part] as Record<string, unknown>
    }
    const last = parts[parts.length - 1]
    const existing = cursor[last]
    // A parent object declared earlier keeps the children collected so far.
    if (!(isPlainObject(existing) && Object.keys(existing).length > 0)) cursor[last] = bodyLeaf(field)
  }
  return JSON.stringify(root, null, 2)
}

function authHeaders(
  config: ApiMdxConfig,
  authMethod: unknown,
  warn: Warn,
): Record<string, string> {
  let method: string | undefined = config.auth?.method
  let name = config.auth?.name
  if (authMethod !== undefined) {
    const value = typeof authMethod === 'string' ? authMethod.trim().toLowerCase() : ''
    if (value === 'none' || AUTH_METHODS.has(value)) {
      method = value
      if (value !== config.auth?.method) name = undefined
      if (value === 'key' && !name) {
        warn('"authMethod: key" needs docs.json "api.mdx.auth.name" to know the header; no auth header was prefilled.')
        method = undefined
      }
    } else {
      warn(`"authMethod" frontmatter ${JSON.stringify(authMethod)} is not one of bearer, basic, key, none; using the docs.json auth setting.`)
    }
  }
  if (method === 'bearer') return { Authorization: 'Bearer YOUR_TOKEN' }
  if (method === 'basic') return { Authorization: 'Basic YOUR_BASE64_CREDENTIALS' }
  if (method === 'key' && name) return { [name]: 'YOUR_API_KEY' }
  return {}
}

export interface BuildManualOperationInput {
  pageId: string
  title: string
  api: unknown
  authMethod?: unknown
  /** Page MDX with frontmatter removed. */
  mdx: string
  config: ApiMdxConfig
  /** Non-default locale the page was rendered from; carried so the relay re-reads the same file. */
  locale?: string
  warn?: Warn
}

/** Build the synthetic operation for a manual API page, or null when `api` is unusable. */
export function buildManualOperation(input: BuildManualOperationInput): NormalizedOperation | null {
  const warn = input.warn ?? (() => {})
  const target = parseApiFrontmatter(input.api, warn)
  if (!target) return null
  const fields = extractParamFields(input.mdx, warn)
  const servers = (target.server ? [target.server] : input.config.servers).map((url) => ({ url }))
  if (servers.length === 0) {
    warn('No server for this API page: use a full URL in the "api" frontmatter or set docs.json "api.mdx.server". The playground is disabled.')
  }

  const prefill: OperationPrefill = {
    path: {},
    query: { ...target.query },
    header: authHeaders(input.config, input.authMethod, warn),
    cookie: {},
  }
  for (const [, key] of target.path.matchAll(/{([^{}/]+)}/g)) prefill.path[key] = ''
  for (const field of fields) {
    if (field.location === 'body') continue
    if (field.location === 'path' && !(field.name in prefill.path)) {
      warn(`<ParamField path="${field.name}"> has no matching {${field.name}} in the "api" path.`)
      continue
    }
    const current = prefill[field.location][field.name]
    prefill[field.location][field.name] = field.default ?? current ?? ''
  }
  const body = buildManualBody(fields)
  if (body !== undefined) prefill.body = body

  const parameters: NormalizedOperation['parameters'] = { path: [], query: [], header: [], cookie: [] }
  for (const field of fields) {
    if (field.location === 'body' || (field.location === 'path' && !(field.name in prefill.path))) continue
    parameters[field.location].push({
      name: field.name,
      in: field.location,
      required: field.required,
      schema: { ...(field.type ? { type: field.type } : {}), ...(field.default !== undefined ? { default: field.default } : {}) },
    })
  }

  return {
    specId: MANUAL_SPEC_ID,
    id: `manual-${input.pageId}`,
    key: `${target.method} ${target.path}`,
    title: input.title,
    method: target.method,
    path: target.path,
    isWebhook: false,
    group: 'API',
    tags: [],
    servers,
    parameters,
    responses: [],
    security: [],
    prefill,
    manualPage: input.pageId,
    ...(input.locale ? { manualLocale: input.locale } : {}),
  }
}
