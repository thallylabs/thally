/** Declared and streaming byte limits for the shared JSON reader. */

import { describe, expect, it, vi } from 'vitest'
import { BODY_TOO_LARGE_ERROR, readBoundedJson } from '@/lib/http/bounded-json'

describe('readBoundedJson', () => {
  it('rejects an oversized declared body before reading its stream', async () => {
    const request = new Request('https://docs.example.com/auth', {
      method: 'POST',
      headers: { 'content-length': '101' },
      body: '{}',
    })
    await expect(readBoundedJson(request, 100)).rejects.toThrow(BODY_TOO_LARGE_ERROR)
  })

  it('cancels a chunked stream immediately after it crosses the cap', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60))
        controller.enqueue(new Uint8Array(60))
      },
      cancel,
    })
    const request = new Request('https://docs.example.com/auth', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    await expect(readBoundedJson(request, 100)).rejects.toThrow(BODY_TOO_LARGE_ERROR)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('preserves malformed JSON as a syntax failure', async () => {
    const request = new Request('https://docs.example.com/auth', {
      method: 'POST',
      body: '{not-json',
    })
    await expect(readBoundedJson(request, 100)).rejects.toBeInstanceOf(SyntaxError)
  })
})
