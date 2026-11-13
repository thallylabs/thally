/**
 * Test helpers. `createFakeTransport` serves canned responses by URL (and
 * optionally Accept) and throws on any unknown URL, so an accidental live
 * request fails the test instead of reaching the network.
 */

import { ACCEPT } from '../net/fetcher.js'
import type { Transport, TransportRequest, TransportResponse, TransportError } from '../types.js'

/** A canned response. */
export interface FakeRoute {
  status?: number
  headers?: Record<string, string | string[]>
  body?: string | Uint8Array
  /** Simulate a transport error instead of a response. */
  error?: TransportError['error']
  /** Fixture server only: send the body and keep the response open (a live stream). */
  hold?: boolean
}

/** A route table: URL -> response, or URL -> (request) -> response, or URL -> list served in order. */
export type FakeRoutes = Record<string, FakeRoute | FakeRoute[] | ((req: TransportRequest) => FakeRoute)>

/** A transport over a route table that records every request. */
export function createFakeTransport(routes: FakeRoutes): Transport & { requests: TransportRequest[] } {
  const requests: TransportRequest[] = []
  const counters = new Map<string, number>()
  return {
    requests,
    async request(req) {
      requests.push(req)
      const acceptKey = `${req.url} ${req.headers.accept ?? ''}`
      const entry = routes[acceptKey] ?? routes[req.url]
      if (entry === undefined) throw new Error(`fake transport: unexpected request ${req.url}`)
      let route: FakeRoute
      if (typeof entry === 'function') route = entry(req)
      else if (Array.isArray(entry)) {
        const n = counters.get(req.url) ?? 0
        counters.set(req.url, n + 1)
        route = entry[Math.min(n, entry.length - 1)]
      } else route = entry
      if (route.error) return { error: route.error }
      const body = typeof route.body === 'string' ? new TextEncoder().encode(route.body) : route.body ?? new Uint8Array()
      const limit = Math.min(req.maxBodyBytes, req.stopAfterBytes ?? Number.POSITIVE_INFINITY)
      const headers: Array<[string, string]> = []
      for (const [name, value] of Object.entries(route.headers ?? {})) {
        for (const item of Array.isArray(value) ? value : [value]) headers.push([name.toLowerCase(), item])
      }
      headers.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      const response: TransportResponse = {
        url: req.url,
        status: route.status ?? 200,
        headers,
        body: body.byteLength > limit ? body.subarray(0, limit) : body,
        truncated: body.byteLength > limit,
      }
      return response
    },
  }
}

/** HTML response helper. */
export function html(body: string, extra: Partial<FakeRoute> = {}): FakeRoute {
  return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...extra.headers }, body, ...(extra.status ? { status: extra.status } : {}) }
}

/** Plain-text response helper. */
export function text(body: string, type = 'text/plain'): FakeRoute {
  return { status: 200, headers: { 'content-type': type }, body }
}

/** Accept header of the plain content-negotiation request, for route keys. */
export const NEGOTIATE = ACCEPT['alt-negotiate']

/** 404 helper. */
export const notFound: FakeRoute = { status: 404, headers: { 'content-type': 'text/html' }, body: 'not found' }

/** Build a documentation page with the common good-practice signals. */
export function docPage(options: {
  url: string
  title: string
  description?: string
  h1?: string
  body?: string
  links?: string[]
  head?: string
  jsonLd?: unknown
  footer?: string
}): string {
  const description = options.description ?? `${options.title} description`
  const jsonLd = options.jsonLd ?? {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: options.title,
    description,
    dateModified: '2026-01-01',
    publisher: { '@type': 'Organization', name: 'Example' },
  }
  const links = (options.links ?? []).map((href) => `<a href="${href}">${href}</a>`).join('\n')
  return `<!doctype html><html lang="en"><head>
<title>${options.title} | Example Docs</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${options.url}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
${options.head ?? ''}
</head><body><nav>${links}</nav><main>
<h1>${options.h1 ?? options.title}</h1>
<p>${options.body ?? 'This page explains the feature in enough detail for a reader to use it. '.repeat(5)}</p>
<h2>Usage</h2><p>Use it.</p>
<a href="https://github.com/example/docs/edit/main/page.md">Edit this page</a>
</main><footer>${options.footer ?? '© 2026 <a href="https://example.com">Example Inc.</a>'}</footer></body></html>`
}
