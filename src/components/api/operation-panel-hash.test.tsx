/** Generated field links reveal their lazy union branches before scrolling to a visible target. */

// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'

vi.mock('@/components/api/operation-code-panel', () => ({ OperationCodePanel: () => null }))
vi.mock('@/components/api/use-try-it-controller', () => ({ useTryItController: () => ({}) }))

let container: HTMLElement
let root: Root
const scrolled: Array<{ id: string; hidden: boolean }> = []

beforeEach(() => {
  scrolled.length = 0
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push({ id: this.id, hidden: Boolean(this.closest('[hidden]')) })
  }
  window.location.hash = ''
  document.body.innerHTML = '<div id="root"></div>'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.getElementById('root') as HTMLElement
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  vi.restoreAllMocks()
})

const choices = {
  oneOf: [
    { type: 'object', title: 'Success', properties: { status: { type: 'string' } } },
    { type: 'object', title: 'Failure', properties: { message: { type: 'string' } } },
  ],
}

/** Effects, descendant mounting, mutation observers and animation frames settle in separate browser turns. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

async function mount(schema: Record<string, unknown> = choices, body = false): Promise<void> {
  const content = { 'application/json': { schema } }
  const operation = operationFrom({
    openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/things': { post: {
      responses: { '200': { description: 'ok', content } },
      ...(body ? { requestBody: { content } } : {}),
    } } },
  })
  await act(async () => { root.render(<OperationPanel operation={operation} playground="simple" />) })
  await settle()
}

async function go(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })
  await settle()
}

const selected = () => Array.from(container.querySelectorAll('[role="tab"][aria-selected="true"]')).map((tab) => tab.textContent)

describe('generated operation field hashes', () => {
  it.each(['#response-one-of-1-message', '#%72esponse-one-of-1-message'])('selects an inactive response variant on load for %s and scrolls to its mounted field', async (hash) => {
    window.location.hash = hash
    await mount()
    expect(selected()).toEqual(['Failure'])
    expect(document.getElementById('response-one-of-1-message')).not.toBeNull()
    expect(scrolled).toContainEqual({ id: 'response-one-of-1-message', hidden: false })
  })

  it('follows changed hashes for body and response independently and keeps manual selection usable', async () => {
    await mount(choices, true)
    await go('#body-one-of-1-message')
    expect(selected()).toEqual(['Failure', 'Success'])
    await go('#response-one-of-1-message')
    expect(selected()).toEqual(['Failure', 'Failure'])
    const success = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((tab) => tab.textContent === 'Success')!
    await act(async () => { success.click() })
    await settle()
    expect(selected()).toEqual(['Success', 'Failure'])
    expect(window.location.hash).toBe('#response-one-of-1-message')
  })

  it.each([true, false])('opens every collapsed ancestor after nested inactive variants mount the target (initial hash: %s)', async (initial) => {
    const hash = '#response-payload-choice-one-of-1-detail-one-of-1-message'
    if (initial) window.location.hash = hash
    await mount({ type: 'object', properties: { payload: { type: 'object', properties: { choice: { oneOf: [
      { type: 'object', title: 'First choice', properties: { id: { type: 'string' } } },
      { type: 'object', title: 'Second choice', properties: { detail: { oneOf: [
        { type: 'object', title: 'First detail', properties: { id: { type: 'string' } } },
        { type: 'object', title: 'Second detail', properties: { message: { type: 'string' } } },
      ] } } },
    ] } } } } })
    if (!initial) await go(hash)
    const target = document.getElementById(window.location.hash.slice(1))
    expect(selected()).toEqual(['Second choice', 'Second detail'])
    expect(target).not.toBeNull()
    expect(target?.closest('[hidden]')).toBeNull()
    expect(scrolled).toContainEqual({ id: target!.id, hidden: false })
  })

  it.each(['#response-one-of-10-message', '#response-one-of-01-message', '#other-response-one-of-1-message', '#response-one-of-1oops', '#%E0%A4%A'])('ignores an invalid or unrelated field hash %s', async (hash) => {
    window.location.hash = hash
    await mount()
    expect(selected()).toEqual(['Success'])
    expect(scrolled).toEqual([])
  })
})
