/** Security and resource-bound regressions for the public Try It relay. */

import { lookup } from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApiOperationByKey } from '@/data/api-reference'
import { POST } from './route'

vi.mock('@/data/api-reference', () => ({
  getApiOperationByKey: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

vi.mock('node:https', () => ({
  request: vi.fn(),
}))

function request(payload: Record<string, unknown>) {
  return new NextRequest('https://docs.example.com/api/try-it', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

function allowedPayload(overrides: Record<string, unknown> = {}) {
  return {
    specId: 'default',
    operationPath: '/posts/{id}',
    method: 'GET',
    url: 'https://api.example.com/v1/posts/42?include=author',
    headers: {},
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([
    { address: '93.184.216.34', family: 4 },
  ] as never)
  vi.mocked(getApiOperationByKey).mockResolvedValue({
    operation: {
      specId: 'default',
      path: '/posts/{id}',
      method: 'GET',
      isWebhook: false,
      servers: [{ url: 'https://api.example.com/v1' }],
    },
  } as never)
  vi.mocked(httpsRequest).mockImplementation((options: unknown, callback: unknown) => {
    const client = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }
    client.write = vi.fn()
    client.end = vi.fn(() => {
      const response = Readable.from([Buffer.from('{"ok":true}')]) as Readable & {
        statusCode: number
        statusMessage: string
        headers: Record<string, string>
      }
      response.statusCode = 200
      response.statusMessage = 'OK'
      response.headers = { 'content-type': 'application/json' }
      ;(callback as (value: typeof response) => void)(response)
    })
    void options
    return client as never
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /api/try-it', () => {
  it('rejects loopback and private targets without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request(allowedPayload({ url: 'http://127.0.0.1/latest/meta-data' })))

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a declared hostname if any DNS answer is private', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as never)

    const response = await POST(request(allowedPayload()))

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses Cloudflare public-only fetch without the unsupported DNS lookup API', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(request(allowedPayload()))

    expect(response.status).toBe(200)
    expect(lookup).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects a public origin that is absent from the published operation', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request(allowedPayload({ url: 'https://attacker.example/posts/42' })))

    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['%2fadmin', '%5cadmin', '%252fadmin'])(
    'rejects encoded path separator %s before contacting the operation server',
    async (encoded) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const response = await POST(request(allowedPayload({
        url: `https://api.example.com/v1/posts/${encoded}`,
      })))

      expect(response.status).toBe(403)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('allows only the declared operation and never follows redirects', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(
      request(allowedPayload({ headers: { authorization: 'Bearer reader-key', cookie: 'secret=1' } })),
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(target.toString()).toBe('https://api.example.com/v1/posts/42?include=author')
    expect(init.redirect).toBe('manual')
    expect(init.headers).toEqual({ authorization: 'Bearer reader-key' })
  })

  it('strips semantic method and routing overrides in the Cloudflare connector', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(request(allowedPayload({ headers: {
      authorization: 'Bearer reader-key',
      'x-http-method-override': 'DELETE',
      'X-Method-Override': 'PATCH',
      'x-vendor-method-override': 'PUT',
      'x-original-url': '/admin',
      'x-rewrite-url': '/internal',
      'x-forwarded-uri': '/private',
    } })))

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.headers).toEqual({ authorization: 'Bearer reader-key' })
  })

  it('strips semantic method and routing overrides in the pinned Node connector', async () => {
    const response = await POST(request(allowedPayload({ headers: {
      authorization: 'Bearer reader-key',
      'x-http-method-override': 'DELETE',
      'x-method-override': 'PATCH',
      'x-original-url': '/admin',
      'x-rewrite-url': '/internal',
    } })))

    expect(response.status).toBe(200)
    expect(httpsRequest).toHaveBeenCalledOnce()
    const [options] = vi.mocked(httpsRequest).mock.calls[0] as unknown as [
      { headers: Record<string, string> },
    ]
    expect(options.headers).toEqual({
      authorization: 'Bearer reader-key',
      host: 'api.example.com',
    })
  })

  it('rejects responses above the declared byte budget', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { 'content-length': String(2 * 1024 * 1024 + 1) },
      }),
    ))

    const response = await POST(request(allowedPayload()))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Upstream response is too large' })
  })

  it('requires an operation identity instead of accepting an arbitrary proxy request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await POST(
      request({ method: 'GET', url: 'https://api.example.com/v1/posts/42' }),
    )

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
