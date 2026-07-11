import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { createHmac } from 'node:crypto'

// Route-level integration: real Request objects through the actual POST handler
// (signature gate → event parse → tracking match), no HTTP server needed.
import { POST } from '../webhook/route'

const SECRET = 'route-test-secret'
const prevSecret = process.env.THALLY_TRACK_WEBHOOK_SECRET
const prevStorage = process.env.THALLY_STORAGE

function makeRequest(body: string, headers: Record<string, string>): Request {
  return new Request('http://localhost/api/track/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

beforeEach(() => {
  process.env.THALLY_TRACK_WEBHOOK_SECRET = SECRET
  process.env.THALLY_STORAGE = 'memory'
})

afterAll(() => {
  if (prevSecret === undefined) delete process.env.THALLY_TRACK_WEBHOOK_SECRET
  else process.env.THALLY_TRACK_WEBHOOK_SECRET = prevSecret
  if (prevStorage === undefined) delete process.env.THALLY_STORAGE
  else process.env.THALLY_STORAGE = prevStorage
})

describe('POST /api/track/webhook', () => {
  it('fails closed (401) when the secret is unset', async () => {
    delete process.env.THALLY_TRACK_WEBHOOK_SECRET
    const res = await POST(makeRequest('{}', {}))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('webhook_not_configured')
  })

  it('rejects a bad signature with 401', async () => {
    const res = await POST(makeRequest('{}', { 'x-hub-signature-256': 'sha256=deadbeef', 'x-github-event': 'ping' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('bad_signature')
  })

  it('answers a signed ping with pong', async () => {
    const body = '{"zen":"Keep it logically awesome."}'
    const res = await POST(makeRequest(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'ping' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, pong: true })
  })

  it('noops signed non-pull_request events (e.g. push)', async () => {
    const body = '{"ref":"refs/heads/main"}'
    const res = await POST(makeRequest(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'push' }))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe('unhandled_event')
  })

  it('noops a signed merged PR for an untracked repo (this project tracks none)', async () => {
    const body = JSON.stringify({
      action: 'closed',
      pull_request: { number: 1, merged: true, html_url: 'u', base: { ref: 'main' } },
      repository: { full_name: 'acme/untracked' },
    })
    const res = await POST(makeRequest(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'pull_request' }))
    expect(res.status).toBe(200)
    expect((await res.json()).reason).toBe('not_tracked')
  })
})
