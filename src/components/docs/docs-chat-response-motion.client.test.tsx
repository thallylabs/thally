/** Real renderer checks: arriving text stays immediate, stable and safely interruptible. */
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatResponse, type ChatResponseStatus } from './docs-chat-response'

let container: HTMLDivElement
let root: Root
const writeText = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

async function render(text: string, status: ChatResponseStatus = 'streaming') {
  await act(async () => { root.render(<ChatResponse text={text} status={status} sources={[{ title: 'Guide', url: '/guide' }]} onRetry={() => {}} isRetryDisabled={false} />) })
}
function word(text: string) { return Array.from(container.querySelectorAll('[data-stream-word]')).find((node) => node.textContent === text)! }

describe('assistant arrival motion', () => {
  it('shows an accessible thinking wave before text and pauses it when the page is hidden', async () => {
    await render('')
    expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Thinking…')
    expect(container.textContent).toBe('Thinking…')
    expect(container.querySelector('[aria-hidden="true"]')?.children.length).toBe(9)
    expect(container.querySelector('[data-stream-caret]')).toBeNull()
    expect(container.querySelector('[aria-label="Answer actions"]')).toBeNull()
    const oldVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    try {
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(container.querySelector('[data-motion-paused="true"]')).not.toBeNull()
    } finally {
      if (oldVisibility) Object.defineProperty(document, 'visibilityState', oldVisibility)
      else Reflect.deleteProperty(document, 'visibilityState')
    }
  })

  it('reveals all received words immediately and preserves old word nodes on append', async () => {
    await render('Earlier words', 'done')
    const earlier = word('Earlier')
    await render('Earlier words arrive')
    const arrived = word('arrive')
    expect(word('Earlier')).toBe(earlier)
    expect(earlier.hasAttribute('data-stream-new')).toBe(false)
    expect(arrived.getAttribute('data-stream-new')).toBe('true')
    await render('Earlier words arrive immediately')
    expect(word('arrive')).toBe(arrived)
    expect(word('Earlier')).toBe(earlier)
    expect(container.querySelector('.prose')?.textContent).toBe('Earlier words arrive immediately')
    const caret = container.querySelector('[data-stream-caret]')!
    expect(caret.parentElement?.tagName).toBe('P')
    expect(caret.previousSibling).toBe(word('immediately'))
    expect(container.textContent).not.toContain('Thinking')
  })

  it('does not replay old words after incomplete Markdown becomes a strong node', async () => {
    await render('**Earlier')
    await render('**Earlier** newer')
    expect(container.querySelector('strong')?.textContent).toBe('Earlier')
    expect(word('Earlier').hasAttribute('data-stream-new')).toBe(false)
    expect(word('newer').getAttribute('data-stream-new')).toBe('true')
  })

  it('keeps code unwrapped and stable while the actual tail caret moves into new prose', async () => {
    await render('```ts\nconst value = 1\n```')
    const code = container.querySelector('pre code')!
    expect(code.querySelector('[data-stream-word]')).toBeNull()
    expect(code.textContent).toBe('const value = 1\n')
    expect(code.querySelector('[data-stream-caret]')).not.toBeNull()
    await render('```ts\nconst value = 1\n```\n\nMore explanation')
    expect(container.querySelector('pre code')).toBe(code)
    expect(code.textContent).toBe('const value = 1\n')
    expect(code.querySelector('[data-stream-caret]')).toBeNull()
    expect(container.querySelectorAll('[data-stream-caret]')).toHaveLength(1)
    expect(container.querySelector('[data-stream-caret]')?.parentElement?.tagName).toBe('P')
  })

  it('keeps model image alt text inert and places the caret at its visible tail', async () => {
    await render('![A diagram](https://tracker.example/pixel)')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.prose')?.textContent).toBe('A diagram')
    const caret = container.querySelector('[data-stream-caret]')!
    expect(caret.parentElement?.tagName).toBe('P')
    expect(caret.previousSibling).toBe(word('diagram'))
  })

  it.each(['done', 'stopped', 'error'] as const)('settles %s immediately and copies the entire received answer', async (status) => {
    const text = 'Every **received** word'
    await render(text)
    expect(container.querySelector('[data-stream-caret]')).not.toBeNull()
    await render(text, status)
    expect(container.querySelector('[data-slot="chat-response"]')?.getAttribute('data-status')).toBe(status)
    expect(container.querySelector('[data-stream-caret]')).toBeNull()
    expect(container.querySelector('[aria-label="Answer actions"]')).not.toBeNull()
    expect(container.querySelector('.prose')?.textContent).toBe('Every received word')
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Copy response"]')!.click() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
  })

  it('keeps security boundaries while decorating words and releases visibility listeners on unmount', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    await render('[Guide](/guide) [Fake](https://fake.example) ![Alt](https://tracker.example) <script>bad()</script>')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/guide')
    expect(container.querySelector('img, script, stream-word, stream-caret')).toBeNull()
    expect(container.textContent).toContain('Alt')
    await act(async () => { root.render(null) })
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
