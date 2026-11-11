/**
 * Serve a fake-transport route table over real HTTP on 127.0.0.1, so the
 * Node transport, capture and CLI can be exercised end to end without the
 * internet. Route URLs are rewritten from the fixture origin to the server.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { FakeRoute, FakeRoutes } from './helpers.js'

/** A running fixture server. */
export interface FixtureServer {
  origin: string
  close: () => Promise<void>
}

/**
 * Start a server for routes built by `build(origin)`. Only static routes are
 * served; an `Accept`-qualified key (`<url> <accept>`) wins when the request
 * Accept matches exactly.
 */
export async function startFixtureServer(build: (origin: string) => FakeRoutes): Promise<FixtureServer> {
  let routes: FakeRoutes = {}
  const server: Server = createServer((req, res) => {
    const url = `${origin}${req.url ?? '/'}`
    const entry = routes[`${url} ${req.headers.accept ?? ''}`] ?? routes[url]
    const route: FakeRoute | undefined = Array.isArray(entry) ? entry[0] : typeof entry === 'function' ? undefined : entry
    if (!route || route.error) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      headers[name] = Array.isArray(value) ? value.map((v) => v.replaceAll(FIXTURE_ORIGIN, origin)) : value.replaceAll(FIXTURE_ORIGIN, origin)
    }
    res.writeHead(route.status ?? 200, headers)
    const body = route.body ?? ''
    res.end(typeof body === 'string' ? body.replaceAll(FIXTURE_ORIGIN, origin) : Buffer.from(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  routes = build(origin)
  return {
    origin,
    close: () => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

/** Placeholder origin some fixtures embed; rewritten to the live server origin. */
export const FIXTURE_ORIGIN = 'https://fixture.invalid'
