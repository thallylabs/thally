/**
 * Resolve repository-authored remote OpenAPI references before materializing a
 * site. The local downloader pins a publicly resolved address for each HTTPS
 * hop; hosted callers may inject their own DNS-pinned fetch boundary.
 */
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'

import { parse as parseYaml } from 'yaml'

import { splitOpenApiRef, withSpecRef } from './openapi-ref.js'
import { insertApiTab } from './navigation.js'
import { dropConflictingRedirects, literalRoute, servedRoutes } from './redirects.js'
import { apiOperationLinkMap, isWithheld, mintlifyEndpointRedirects, rewriteApiLinksInPages } from './repository.js'
import { markExcluded, sharedSpecMessage } from './spec-exclude.js'
import type { MigrationBundle, MigrationFetcher } from './types.js'

const MAX_SPEC_BYTES = 25_000_000
const MAX_REDIRECTS = 3

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [a, b] = parts
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 203 && b === 0)
      || (a === 198 && b === 51))
  }
  // Global unicast only. This excludes loopback, link-local, unique-local,
  // mapped IPv4, multicast, and every host-local address family.
  return family === 6 && /^[23][0-9a-f]{0,3}:/i.test(address)
    && !/^2001:db8:/i.test(address)
}

function validatedSpecUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname)) {
    throw new Error('Remote OpenAPI references must use an HTTPS domain without credentials or an IP literal.')
  }
  url.hash = ''
  return url
}

async function getPinnedAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.length === 0 || addresses.some((candidate) => !isPublicAddress(candidate.address, candidate.family))) {
    throw new Error('The OpenAPI host did not resolve exclusively to public addresses.')
  }
  return addresses[0] as { address: string; family: 4 | 6 }
}

interface SpecResponse {
  status: number
  location?: string
  body: Buffer
}

async function requestPinnedSpec(url: URL): Promise<SpecResponse> {
  const pinned = await getPinnedAddress(url)
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*', 'User-Agent': 'Thally-Migrate/1.0 (+https://thally.io)' },
      signal: AbortSignal.timeout(30_000),
      // Node's dual-stack connector asks lookup for `all: true`; that
      // callback must receive address records, not a single address string.
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
    }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        response.resume()
        resolve({ status, location: response.headers.location, body: Buffer.alloc(0) })
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`OpenAPI server returned ${status}.`))
        return
      }
      const statedBytes = Number(response.headers['content-length'] ?? 0)
      if (statedBytes > MAX_SPEC_BYTES) {
        response.destroy()
        reject(new Error('Remote OpenAPI spec exceeds the 25 MB import limit.'))
        return
      }
      const chunks: Array<Buffer> = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_SPEC_BYTES) {
          response.destroy(new Error('Remote OpenAPI spec exceeds the 25 MB import limit.'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

async function downloadSpec(value: string, fetcher?: MigrationFetcher): Promise<Buffer> {
  let url = validatedSpecUrl(value)
  if (fetcher) {
    const response = await fetcher(url, { accept: 'application/json, application/yaml, text/yaml' })
    validatedSpecUrl(response.finalUrl.toString())
    const body = Buffer.from(response.body)
    if (body.length > MAX_SPEC_BYTES) throw new Error('Remote OpenAPI spec exceeds the 25 MB import limit.')
    return body
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await requestPinnedSpec(url)
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || hop === MAX_REDIRECTS) throw new Error('Remote OpenAPI spec redirected too many times.')
      url = validatedSpecUrl(new URL(response.location, url).toString())
      continue
    }
    return response.body
  }
  throw new Error('Remote OpenAPI spec redirected too many times.')
}

interface OpenApiOperation {
  method: string
  path: string
  tag: string
  summary: string
}

/** A UTF-8 byte order mark ahead of the document: `JSON.parse` rejects it, so a spec saved with one would not load as JSON. */
function withoutByteOrderMark(content: Buffer): Buffer {
  return content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf ? content.subarray(3) : content
}

/**
 * The format the body is actually in. A remote endpoint may serve YAML from a
 * path without a .yaml suffix (or JSON from one with it), so the URL says
 * nothing reliable; the saved extension must match this, or the install step
 * drops a YAML spec saved as `.json` as invalid JSON.
 */
function specFormat(content: Buffer): 'json' | 'yaml' {
  return content.toString('utf8').trimStart().startsWith('{') ? 'json' : 'yaml'
}

function parseOpenApi(content: Buffer, format: 'json' | 'yaml'): Array<OpenApiOperation> {
  const text = content.toString('utf8')
  const parsed = format === 'yaml' ? parseYaml(text) as unknown : JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OpenAPI spec is not an object.')
  const document = parsed as Record<string, unknown>
  if (typeof document.openapi !== 'string' || !/^3\./.test(document.openapi)) {
    throw new Error('Remote specification is not OpenAPI 3.x.')
  }
  if (!document.paths || typeof document.paths !== 'object' || Array.isArray(document.paths)) {
    throw new Error('Remote OpenAPI spec has no paths object.')
  }
  const paths = Object.entries(document.paths as Record<string, unknown>)
  if (paths.length > 5_000) throw new Error('Remote OpenAPI spec has too many paths to import.')
  const operations: Array<OpenApiOperation> = []
  for (const [path, value] of paths) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isWithheld(value as Record<string, unknown>)) continue
    for (const [method, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!/^(get|post|put|patch|delete|head|options|trace)$/i.test(method)
        || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const operation = raw as Record<string, unknown>
      // The published spec does not carry a withheld operation, so no endpoint page exists to redirect to.
      if (isWithheld(operation)) continue
      const tags = Array.isArray(operation.tags) ? operation.tags : []
      operations.push({
        method: method.toLowerCase(),
        path,
        tag: typeof tags[0] === 'string' ? tags[0] : 'API Reference',
        summary: typeof operation.summary === 'string' ? operation.summary : String(operation.operationId ?? ''),
      })
    }
  }
  return operations
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function operationTarget(operation: OpenApiOperation): string {
  const path = operation.path.split('/').filter(Boolean)
    .map((part) => part.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').toLowerCase())
  return `/api/default/${[...path, operation.method].join('/')}`
}

/**
 * Attach safely downloaded specs to the exact authored API tabs. A spec
 * mounted under Mintlify `directory` folders gets a redirect from each
 * endpoint URL those folders served; for any other spec, source links to
 * Mintlify's tag/summary routes receive redirects only when an operation can
 * be identified uniquely, since guessing would silently route to wrong APIs.
 * A redirect never takes the place of a page the site serves.
 */
export async function hydrateRemoteApiSpecs(bundle: MigrationBundle, fetcher?: MigrationFetcher): Promise<MigrationBundle> {
  if (!bundle.remoteApiSpecs?.length) return bundle
  const assets = [...bundle.assets]
  const tabs = bundle.docsConfig.tabs.map((tab) => ({ ...tab }))
  const redirects = [...(bundle.docsConfig.redirects ?? [])]
  const warnings = [...bundle.warnings]
  const pages = bundle.pages.map((page) => ({ ...page }))
  const authoredLinks = new Set<string>()
  const served = servedRoutes(pages)
  // Mintlify endpoint URL -> Thally endpoint page, for every redirect generated below.
  const endpointUrls = new Map<string, string>()
  for (const page of bundle.pages) {
    // Scan path-shaped tokens once, then inspect segments without nested
    // regex quantifiers. Authored pages may be arbitrarily long or hostile.
    for (const match of page.body.matchAll(/\/[a-z0-9_/-]+/gi)) {
      const segments = match[0].split('/').filter(Boolean)
      if (segments.length < 3) continue
      const section = segments[0].toLowerCase()
      // `/x/y/` and `/x/y` are one URL.
      if (section.includes('api') || section.includes('reference')) authoredLinks.add(match[0].replace(/\/+$/, ''))
    }
  }
  for (const reference of bundle.remoteApiSpecs) {
    for (let index = warnings.length - 1; index >= 0; index--) {
      if (warnings[index].source === reference.url && warnings[index].message.includes('requires a network download')) warnings.splice(index, 1)
    }
    try {
      const downloaded = withoutByteOrderMark(await downloadSpec(reference.url, fetcher))
      // Fail closed: operations only access-restricted pages document are not published.
      const pruned = markExcluded(downloaded, reference.withheldOperations ?? [], reference.keptOperations)
      const body = pruned.content
      if (reference.withheldOperations?.length) warnings.push({ code: 'gated-page', message: sharedSpecMessage(reference.url, pruned.excluded), source: reference.url })
      const extension = specFormat(body)
      const operations = parseOpenApi(body, extension)
      const filename = `openapi-${createHash('sha256').update(reference.url).digest('hex').slice(0, 12)}.${extension}`
      // Several tabs may bind one spec: it is saved once.
      if (!assets.some((asset) => asset.path === `openapi/${filename}`)) assets.push({ path: `openapi/${filename}`, content: body, projectRelative: true })
      // Pages that name this spec by URL now resolve to the downloaded copy.
      for (const page of pages) {
        const ref = page.openapi ? splitOpenApiRef(page.openapi) : null
        if (ref?.specRef === reference.url) page.openapi = withSpecRef(ref, `openapi/${filename}`)
      }
      const tab = reference.tabLabel
        ? tabs.find((candidate) => candidate.tab === reference.tabLabel)
        : tabs.find((candidate) => candidate.tab.toLowerCase().includes('api'))
      if (tab) tab.api = { source: `openapi/${filename}` }
      else insertApiTab(tabs, { tab: reference.tabLabel ?? 'API Reference', ...(reference.icon ? { icon: reference.icon } : {}), ...(reference.hidden ? { hidden: true } : {}), api: { source: `openapi/${filename}` } }, reference.parentTab)

      if (reference.directories?.length) {
        const maps = apiOperationLinkMap(
          reference.directories.map(({ directory, operations: listed }) => ({ filename, content: body, prefix: directory, tab: tab?.tab ?? reference.tabLabel ?? 'API Reference', ...(listed ? { operations: listed } : {}) })),
          { ...bundle.docsConfig, tabs },
        )
        rewriteApiLinksInPages(pages, maps.operationLinks, maps.prefixLandings, warnings)
        for (const redirect of mintlifyEndpointRedirects(maps, pages, redirects, warnings)) {
          redirects.push(redirect)
          endpointUrls.set(literalRoute(redirect.source) ?? redirect.source, redirect.destination)
        }
      }
      const routes = new Map<string, string | null>()
      for (const operation of operations) {
        const key = `${slug(operation.tag)}/${slug(operation.summary)}`
        if (routes.has(key)) routes.set(key, null)
        else routes.set(key, operationTarget(operation))
      }
      const existingSources = new Set(redirects.map((redirect) => redirect.source))
      for (const source of authoredLinks) {
        const parts = source.split('/').filter(Boolean)
        const key = parts.slice(-2).join('/')
        const destination = routes.get(key)
        if (!destination || existingSources.has(source) || served.has(literalRoute(source) ?? source)) continue
        redirects.push({ source, destination, permanent: false })
        existingSources.add(source)
      }
    } catch (error) {
      warnings.push({
        code: 'fetch-failed',
        source: reference.url,
        message: `Remote OpenAPI spec could not be imported: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  // A redirect that targets an endpoint URL goes straight to the endpoint page, not through a second redirect.
  const direct = redirects.map((redirect) => {
    const endpoint = endpointUrls.get(literalRoute(redirect.destination) ?? '')
    return endpoint ? { ...redirect, destination: endpoint } : redirect
  })
  return {
    ...bundle,
    pages,
    assets,
    // Links in page bodies became redirects above; none may hide a page that exists.
    docsConfig: dropConflictingRedirects({ ...bundle.docsConfig, tabs, ...(direct.length > 0 ? { redirects: direct } : {}) }, pages, warnings),
    warnings,
  }
}
