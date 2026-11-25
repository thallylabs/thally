/**
 * Bounded Ask AI wire protocol shared by the browser, runtime and managed
 * service. Snapshots allow incomplete Markdown to be reinterpreted safely;
 * only an explicit terminal event means the metered answer completed.
 */

import { AI_FOLLOW_UPS_HEADER, normalizeAiSuggestions, parseAiFollowUps } from '@/lib/ai-chat-suggestions'
import { normalizeAiAnswerSources, type AiAnswerSource } from '@/lib/ai-answer-sources'

export const AI_CHAT_STREAM_CONTENT_TYPE = 'text/event-stream'
export const AI_CHAT_INTERRUPTED_MESSAGE = 'The response was interrupted. Please try again.'
export const MAX_AI_CHAT_ANSWER_CHARS = 131_072
const MAX_EVENT_CHARS = MAX_AI_CHAT_ANSWER_CHARS * 2
const MAX_STREAM_BYTES = 16 * 1024 * 1024

export type AiChatStreamEvent =
  | { type: 'answer'; text: string; citations?: Array<AiAnswerSource> }
  | { type: 'done'; text: string; followUps: Array<string>; citations?: Array<AiAnswerSource> }
  | { type: 'error'; message: string }

/** Whether the caller explicitly supports the streaming answer protocol. */
export function acceptsAiChatStream(headers: Headers): boolean {
  return (headers.get('accept') ?? '').split(',').some((part) => {
    const [mediaType, ...parameters] = part.trim().toLowerCase().split(';')
    return mediaType === AI_CHAT_STREAM_CONTENT_TYPE && !parameters.some((parameter) => /^\s*q=0(?:\.0*)?\s*$/.test(parameter))
  })
}

/** Encode one JSON event without permitting model text to inject SSE fields. */
export function encodeAiChatStreamEvent(event: AiChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

function parseEvent(value: string): AiChatStreamEvent {
  let event: unknown
  try { event = JSON.parse(value) } catch { throw new Error(AI_CHAT_INTERRUPTED_MESSAGE) }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
  const record = event as Record<string, unknown>
  if ((record.type === 'answer' || record.type === 'done') && typeof record.text === 'string' && record.text.length <= MAX_AI_CHAT_ANSWER_CHARS) {
    // Absence means an older service; an explicit empty allowlist means no
    // links were grounded and must never fall back to unrelated source pages.
    const citations = Object.hasOwn(record, 'citations') ? { citations: normalizeAiAnswerSources(record.citations, 64) } : {}
    return record.type === 'done'
      ? { type: 'done', text: record.text, followUps: normalizeAiSuggestions(record.followUps), ...citations }
      : { type: 'answer', text: record.text, ...citations }
  }
  if (record.type === 'error' && typeof record.message === 'string') {
    return { type: 'error', message: record.message.slice(0, 500) || AI_CHAT_INTERRUPTED_MESSAGE }
  }
  throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
}

/**
 * Consume split UTF-8 and SSE frames, or the older plain-text transport. EOF
 * without a terminal SSE event is a failure, preserving the last good snapshot.
 */
export async function readAiChatResponse(
  response: Response,
  onEvent: (event: AiChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const streaming = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === AI_CHAT_STREAM_CONTENT_TYPE
  let buffer = ''
  let text = ''
  let bytes = 0
  let terminal = false
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  const emitFrames = () => {
    // CRLF may split across network chunks; normalize only after both bytes
    // arrived so a partial delimiter cannot be mistaken for an empty frame.
    buffer = buffer.replace(/\r\n/g, '\n')
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      if (frame.length > MAX_EVENT_CHARS) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')
      if (!data) continue
      const event = parseEvent(data)
      onEvent(event)
      if (event.type !== 'answer') {
        terminal = true
        return
      }
    }
    if (buffer.length > MAX_EVENT_CHARS) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
  }
  try {
    while (!terminal) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) {
        const tail = decoder.decode()
        if (streaming) {
          buffer += tail
          emitFrames()
          if (!terminal) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
        } else {
          text += tail
          if (text.length > MAX_AI_CHAT_ANSWER_CHARS) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
          onEvent({ type: 'done', text, followUps: parseAiFollowUps(response.headers.get(AI_FOLLOW_UPS_HEADER)) })
        }
        return
      }
      bytes += value.byteLength
      if (bytes > MAX_STREAM_BYTES) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
      const chunk = decoder.decode(value, { stream: true })
      if (streaming) {
        buffer += chunk
        emitFrames()
      } else {
        text += chunk
        if (text.length > MAX_AI_CHAT_ANSWER_CHARS) throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
        onEvent({ type: 'answer', text })
      }
    }
  } catch (error) {
    // A socket/decoder failure after response headers is an interrupted
    // answer, rather than a new connection failure. Keep abort identity.
    if (signal?.aborted) throw error
    throw new Error(AI_CHAT_INTERRUPTED_MESSAGE)
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
