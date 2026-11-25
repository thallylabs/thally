/** Wire boundaries preserve partial answers and require confirmed completion. */
import { describe, expect, it, vi } from 'vitest'
import { acceptsAiChatStream, AI_CHAT_INTERRUPTED_MESSAGE, encodeAiChatStreamEvent, MAX_AI_CHAT_ANSWER_CHARS, readAiChatResponse, type AiChatStreamEvent } from '../ai-chat-stream'

function response(chunks: Array<Uint8Array | string>, type = 'text/event-stream') {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({ start(controller) {
    chunks.forEach((chunk) => controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk))
    controller.close()
  } }), { headers: { 'content-type': type } })
}

describe('Ask AI stream protocol', () => {
  it('decodes UTF-8 and CRLF frames split at every network byte', async () => {
    const wire = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"type":"answer","text":"Hello 🌍"}\r\n\r\ndata: {"type":"done","text":"Hello 🌍!","followUps":[" Next? ","Next?"]}\r\n\r\n')
    const events: Array<AiChatStreamEvent> = []
    await readAiChatResponse(response(Array.from(wire, (byte) => new Uint8Array([byte]))), (event) => events.push(event))
    expect(events).toEqual([{ type: 'answer', text: 'Hello 🌍' }, { type: 'done', text: 'Hello 🌍!', followUps: ['Next?'] }])
  })

  it('delivers a growing snapshot before the response completes', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const onEvent = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const task = readAiChatResponse(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), onEvent)
    controller.enqueue(encodeAiChatStreamEvent({ type: 'answer', text: 'First part' }))
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith({ type: 'answer', text: 'First part' }))
    controller.enqueue(encodeAiChatStreamEvent({ type: 'done', text: 'First part, complete.', followUps: [] }))
    await task
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'done', text: 'First part, complete.', followUps: [] })
  })

  it('rejects an interrupted stream after preserving its last snapshot', async () => {
    const onEvent = vi.fn()
    await expect(readAiChatResponse(response([encodeAiChatStreamEvent({ type: 'answer', text: 'Partial' })]), onEvent)).rejects.toThrow(AI_CHAT_INTERRUPTED_MESSAGE)
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'answer', text: 'Partial' })
  })

  it.each(['data: not-json\n\n', 'data: {"type":"done","text":42}\n\n', `data: ${JSON.stringify({ type: 'answer', text: 'x'.repeat(MAX_AI_CHAT_ANSWER_CHARS + 1) })}\n\n`])('rejects malformed or oversized input without emitting it', async (wire) => {
    const onEvent = vi.fn()
    await expect(readAiChatResponse(response([wire]), onEvent)).rejects.toThrow(AI_CHAT_INTERRUPTED_MESSAGE)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('treats an error event as terminal and never reports a completed answer', async () => {
    const onEvent = vi.fn()
    await readAiChatResponse(response([encodeAiChatStreamEvent({ type: 'error', message: 'Try again.' })]), onEvent)
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: 'Try again.' })
  })

  it('reports truncated UTF-8 as interruption after retaining a prior snapshot', async () => {
    const onEvent = vi.fn()
    await expect(readAiChatResponse(response([encodeAiChatStreamEvent({ type: 'answer', text: 'Partial' }), new Uint8Array([0xf0, 0x9f])]), onEvent)).rejects.toThrow(AI_CHAT_INTERRUPTED_MESSAGE)
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'answer', text: 'Partial' })
  })

  it('aborts a pending read and cancels the reader', async () => {
    const cancel = vi.fn()
    const controller = new AbortController()
    const task = readAiChatResponse(new Response(new ReadableStream({ cancel })), vi.fn(), controller.signal)
    controller.abort()
    await expect(task).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps old plain text responses incremental and reads their follow-up header', async () => {
    const result = response(['First ', 'part 🌍'], 'text/plain; charset=utf-8')
    result.headers.set('x-thally-ai-follow-ups', encodeURIComponent(JSON.stringify(['Next?'])))
    const events: Array<AiChatStreamEvent> = []
    await readAiChatResponse(result, (event) => events.push(event))
    expect(events).toEqual([{ type: 'answer', text: 'First ' }, { type: 'answer', text: 'First part 🌍' }, { type: 'done', text: 'First part 🌍', followUps: ['Next?'] }])
  })

  it('requires explicit opt-in and respects q=0', () => {
    expect(acceptsAiChatStream(new Headers({ accept: 'text/plain, text/event-stream; q=0.8' }))).toBe(true)
    expect(acceptsAiChatStream(new Headers({ accept: 'text/event-stream;q=0' }))).toBe(false)
    expect(acceptsAiChatStream(new Headers({ accept: '*/*' }))).toBe(false)
  })

  it('bounds citation metadata and distinguishes an empty allowlist from older absent metadata', async () => {
    const events: Array<AiChatStreamEvent> = []
    await readAiChatResponse(response([
      encodeAiChatStreamEvent({ type: 'answer', text: 'Older service' }),
      encodeAiChatStreamEvent({ type: 'answer', text: 'No grounded links', citations: [] }),
      encodeAiChatStreamEvent({ type: 'done', text: 'Grounded', followUps: [], citations: [{ title: 'Guide', url: '/guide' }, { title: 'Injected', url: '/\n/evil.example' }] }),
    ]), (event) => events.push(event))
    expect(events[0]).not.toHaveProperty('citations')
    expect(events[1]).toHaveProperty('citations', [])
    expect(events[2]).toHaveProperty('citations', [{ title: 'Guide', url: '/guide' }])
  })
})
