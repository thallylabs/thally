/** Real component lifecycle coverage for cancellation, retries and input ownership. */
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeAiChatStreamEvent } from '@/lib/ai-chat-stream'

vi.mock('@/components/layout/site-brand-mark', () => ({ SiteBrandMark: () => null }))
vi.mock('next/image', () => ({ default: (props: Record<string, string>) => createElement('img', { src: props.src, alt: props.alt }) }))
import { DocsChat } from './docs-chat'

let root: Root
let container: HTMLDivElement
let openRequestId = 0
const fetchMock = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  openRequestId = 0
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

async function draft(value: string) {
  openRequestId += 1
  await act(async () => { root.render(<DocsChat skipStatusCheck initialPrompt={value} openRequestId={openRequestId} />) })
}
async function submit() {
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}
async function click(label: string) {
  await act(async () => { container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click() })
}
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), { headers: { 'content-type': 'text/event-stream' } })
  return { response, get controller() { return controller } }
}
async function attach(name: string) {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' })
  const field = container.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(field, 'files', { configurable: true, value: [file] })
  await act(async () => {
    field.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
}

describe('assistant streaming lifecycle', () => {
  it('preserves partial text and exposes retry when EOF arrives without completion', async () => {
    const current = stream()
    fetchMock.mockResolvedValue(current.response)
    await draft('First question')
    await submit()
    await act(async () => {
      current.controller.enqueue(encodeAiChatStreamEvent({ type: 'answer', text: 'A useful partial answer.' }))
      current.controller.close()
    })
    expect(container.textContent).toContain('A useful partial answer.')
    expect(container.textContent).toContain('The response was interrupted.')
    expect(container.querySelector('[data-status="error"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Regenerate response"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Follow-ups"]')).toBeNull()
  })

  it('isolates a stopped request even when its fetch resolves after a new question', async () => {
    let resolveOld!: (value: Response) => void
    const fresh = stream()
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve })).mockResolvedValueOnce(fresh.response)
    await draft('Old question')
    await submit()
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await click('Stop')
    expect(oldSignal.aborted).toBe(true)
    await draft('New question')
    await submit()
    await act(async () => { resolveOld(new Response('Stale answer')) })
    expect(container.querySelector('[aria-label="Stop"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Stale answer')
    await act(async () => {
      fresh.controller.enqueue(encodeAiChatStreamEvent({ type: 'done', text: 'Fresh answer', followUps: ['Next question?'] }))
    })
    expect(container.textContent).toContain('Fresh answer')
    expect(container.textContent).toContain('Next question?')
    expect(container.querySelector('[aria-label="Stop"]')).toBeNull()
  })

  it('retries original screenshots without consuming a new draft or attachments', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Try again.', { status: 503 }))
    const retry = stream()
    fetchMock.mockResolvedValueOnce(retry.response)
    await draft('Explain this screenshot')
    await attach('original.png')
    await submit()
    await draft('Unsent next question')
    await attach('next.png')
    await click('Regenerate response')
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(payload.messages).toHaveLength(1)
    expect(payload.messages[0]).toMatchObject({ role: 'user', content: 'Explain this screenshot', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] })
    expect(container.querySelector('textarea')!.value).toBe('Unsent next question')
    expect(container.querySelector('[aria-label="Remove next.png"]')).not.toBeNull()
    await act(async () => { retry.controller.enqueue(encodeAiChatStreamEvent({ type: 'done', text: 'Retried', followUps: [] })) })
    expect(container.querySelector('textarea')!.value).toBe('Unsent next question')
  })

  it('keeps Shift+Enter and IME Enter local while normal Enter sends', async () => {
    fetchMock.mockResolvedValue(new Response('Answer'))
    await draft('Keyboard question')
    const field = container.querySelector('textarea')!
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe('text/event-stream')
  })

  it('aborts the active request on unmount', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    await draft('Pending question')
    await submit()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await act(async () => { root.render(null) })
    expect(signal.aborted).toBe(true)
  })

  it('keeps feedback after closing and reopening the panel and lets a reader clear it', async () => {
    fetchMock.mockResolvedValue(new Response('Completed answer'))
    await draft('Question')
    await submit()
    await click('Helpful response')
    expect(container.querySelector('[aria-label="Helpful response"]')!.getAttribute('aria-pressed')).toBe('true')
    await click('Close')
    await draft('')
    expect(container.querySelector('[aria-label="Helpful response"]')!.getAttribute('aria-pressed')).toBe('true')
    await click('Helpful response')
    expect(container.querySelector('[aria-label="Helpful response"]')!.getAttribute('aria-pressed')).toBe('false')
  })
})
