import { describe, it, expect } from 'vitest'

// The open-source distribution has no Track service (src/cloud ships as a
// stub), so the webhook shell must answer with a stable 404 — never 5xx, and
// never a signature-validation response that would imply the pipeline ran.
// The full pipeline (signature gate → event parse → tracking match) is tested
// in the Thally Cloud repo, where the real service lives.
import { POST } from '../webhook/route'

describe('POST /api/track/webhook (no cloud service)', () => {
  it('returns 404 track_unavailable', async () => {
    const res = await POST(
      new Request('http://localhost/api/track/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('track_unavailable')
  })
})
