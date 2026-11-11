import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createCaptureRecorder, writeCapture } from '../net/capture.js'
import { decodeBody } from '../net/decode.js'
import { createFetcher } from '../net/fetcher.js'
import { noopRateLimiter } from '../net/rate-limiter.js'
import { checkFetchableUrl } from '../net/guard.js'
import { createNodeTransport } from '../net/transport.js'
import type { TransportRequest, TransportResponse } from '../types.js'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/redirect') {
      res.writeHead(302, { location: '/final' })
      res.end()
    } else if (url === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      res.end(gzipSync('hello gzip'))
    } else if (url === '/stall') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"partial":')
    } else if (url === '/corrupt-gzip') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      res.end(Buffer.from('this is not gzip data at all'))
    } else if (url === '/br') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'br' })
      res.end(brotliCompressSync('hello br'))
    } else if (url === '/bomb') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      res.end(gzipSync(Buffer.alloc(200_000, 0x61)))
    } else if (url === '/slow') {
      setTimeout(() => {
        res.writeHead(200)
        res.end('late')
      }, 500)
    } else if (url === '/latin1') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(Buffer.concat([Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>caf'), Buffer.from([0xe9]), Buffer.from('</body></html>')]))
    } else if (url === '/cookie') {
      res.writeHead(200, [['Set-Cookie', 'a=1'], ['Content-Type', 'text/plain'], ['Set-Cookie', 'b=2'], ['X-B', '1']])
      res.end('ok')
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`echo ${req.method} ${req.headers['user-agent']}`)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const req = (path: string, extra: Partial<TransportRequest> = {}): TransportRequest => ({
  url: `${base}${path}`, method: 'GET', headers: { 'user-agent': 'test-agent' }, timeoutMs: 2000, maxBodyBytes: 1_000_000, ...extra,
})
const local = createNodeTransport({ allowPrivateNetwork: true })
const asText = (r: unknown) => new TextDecoder().decode((r as TransportResponse).body)

describe('node transport against a local server', () => {
  it('returns redirects without following them', async () => {
    const response = await local.request(req('/redirect')) as TransportResponse
    expect(response.status).toBe(302)
    expect(response.headers).toContainEqual(['location', '/final'])
  })

  it('decodes gzip and brotli', async () => {
    expect(asText(await local.request(req('/gzip')))).toBe('hello gzip')
    expect(asText(await local.request(req('/br')))).toBe('hello br')
  })

  it('caps decompressed bytes and supports prefix reads', async () => {
    const capped = await local.request(req('/bomb', { maxBodyBytes: 1000 })) as TransportResponse
    expect(capped.truncated).toBe(true)
    expect(capped.body.byteLength).toBe(1000)
    const prefix = await local.request(req('/bomb', { stopAfterBytes: 10 })) as TransportResponse
    expect(prefix).toMatchObject({ truncated: true })
    expect(prefix.body.byteLength).toBe(10)
  })

  it('times out', async () => {
    expect(await local.request(req('/slow', { timeoutMs: 50 }))).toEqual({ error: 'timeout' })
  })

  it('decodes a declared ISO-8859-1 page', async () => {
    const response = await local.request(req('/latin1')) as TransportResponse
    expect(decodeBody(response.body, 'text/html')).toContain('café')
  })

  it('sorts headers by name, keeps repeated headers in order, and redacts set-cookie in captures', async () => {
    const recorder = createCaptureRecorder(local)
    const response = await recorder.transport.request(req('/cookie')) as TransportResponse
    const cookies = response.headers.filter(([name]) => name === 'set-cookie').map(([, value]) => value)
    expect(cookies).toEqual(['a=1', 'b=2'])
    const dir = mkdtempSync(join(tmpdir(), 'agent-scan-cap-'))
    writeCapture(dir, { schema: 1, input: base, scannedAt: 'x', methodology: { id: 'thally-agent-scan', version: '1.0' }, scannerVersion: '0', bodies: false }, recorder)
    const line = readFileSync(join(dir, 'exchanges.jsonl'), 'utf8')
    expect(line).not.toContain('a=1')
    expect(line).toContain('[redacted]')
    expect(line).not.toContain('test-agent')
  })

  it('reports a corrupt compressed body as decode, and the fetcher does not retry it', async () => {
    expect(await local.request(req('/corrupt-gzip'))).toEqual({ error: 'decode' })
    const seen: string[] = []
    const counting = { request: (request: TransportRequest) => (seen.push(request.url), local.request(request)) }
    const fetcher = createFetcher({ transport: counting, rateLimiter: noopRateLimiter(), allowPrivateNetwork: true, sleep: async () => {} })
    const outcome = await fetcher.get(`${base}/corrupt-gzip`, { purpose: 'html' })
    expect(outcome.error).toBe('decode')
    expect(seen.filter((url) => url.endsWith('/corrupt-gzip'))).toHaveLength(1)
  })

  it('a probe that times out after its headers returns what arrived instead of an error', async () => {
    const probed = await local.request(req('/stall', { probe: true, timeoutMs: 300 }))
    expect(probed).toMatchObject({ status: 200, truncated: true })
    expect(asText(probed)).toBe('{"partial":')
    expect(await local.request(req('/stall', { timeoutMs: 300 }))).toEqual({ error: 'timeout' })
  })

  it('maps a refused connection to connection', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    closed.close()
    expect(await local.request({ ...req('/'), url: `http://127.0.0.1:${port}/` })).toEqual({ error: 'connection' })
  })
})

describe('SSRF guard', () => {
  const guarded = createNodeTransport()

  it('rejects loopback and mapped addresses with private_address', async () => {
    for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://10.1.2.3/']) {
      expect(await guarded.request({ ...req('/'), url })).toEqual({ error: 'private_address' })
    }
  })

  it('rejects a hostname that resolves to a private address, at connect time', async () => {
    const transport = createNodeTransport({ resolver: async () => [{ address: '10.0.0.1', family: 4 }] })
    expect(await transport.request({ ...req('/'), url: 'http://docs.example.test/' })).toEqual({ error: 'private_address' })
    const mixed = createNodeTransport({ resolver: async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.0.1', family: 4 }] })
    expect(await mixed.request({ ...req('/'), url: 'http://docs.example.test/' })).toEqual({ error: 'private_address' })
  })

  it('rejects unsafe URLs before any request', () => {
    expect(checkFetchableUrl('http://localhost/', false)).toBe('private_address')
    expect(checkFetchableUrl('http://intranet/', false)).toBe('private_address')
    expect(checkFetchableUrl('http://a.localhost/', false)).toBe('private_address')
    expect(checkFetchableUrl('http://user:pw@docs.example.com/', false)).toBe('invalid_url')
    expect(checkFetchableUrl('file:///etc/passwd', false)).toBe('invalid_url')
    expect(checkFetchableUrl('https://docs.example.com:8443/', false)).toBe('invalid_url')
    expect(checkFetchableUrl('https://docs.example.com/', false)).toBeNull()
    expect(checkFetchableUrl('http://127.0.0.1:4000/', true)).toBeNull()
  })
})
