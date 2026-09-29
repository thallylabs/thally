/** Reader entry points stay closed until the server confirms availability. */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Run the provider's effects explicitly in the Node test environment while
// retaining state between renders. The real context still reaches consumers.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => void | (() => void)>,
}))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (next: unknown) => {
      hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next
    }]
  },
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}))
vi.mock('next/dynamic', () => ({
  default: () => ({ initialPrompt }: { initialPrompt?: string }) => <aside data-chat>{initialPrompt}</aside>,
}))

import { DocsCodeActionsProvider, useDocsCodeActions } from './code-actions-provider'

let actions: ReturnType<typeof useDocsCodeActions>
function Consumer() {
  // Test-only observation of the context; no application state is mutated.
  // eslint-disable-next-line react-hooks/globals
  actions = useDocsCodeActions()
  return actions.hasAssistantEntryPoint ? <button>{actions.assistantLabel}</button> : null
}
function render() {
  hooks.cursor = 0
  hooks.effects = []
  return renderToStaticMarkup(
    <DocsCodeActionsProvider initialRepositoryUrl="https://github.com/example/docs">
      <Consumer />
    </DocsCodeActionsProvider>,
  )
}

describe('assistant availability', () => {
  beforeEach(() => {
    hooks.values = []
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(() => vi.unstubAllGlobals())

  function expectUnavailable() {
    expect(render()).not.toContain('<button')
    actions.openAssistant()
    actions.askAssistant('const answer = 42')
    expect(render()).not.toContain('data-chat')
    hooks.effects[2]()
    expect(document.addEventListener).not.toHaveBeenCalled()
    expect(actions.canReportCode).toBe(true)
  }

  it('hides controls, ignores requests, and leaves shortcuts alone while pending', () => {
    expectUnavailable()
  })

  it.each([
    { name: 'disabled', response: { ok: true, json: async () => ({ show: false }) } },
    { name: 'missing status', response: { ok: true, json: async () => ({}) } },
    { name: 'non-boolean status', response: { ok: true, json: async () => ({ show: 'true' }) } },
    { name: 'HTTP failure', response: { ok: false } },
    { name: 'invalid JSON', response: { ok: true, json: async () => { throw new Error('invalid') } } },
    { name: 'network failure', response: null },
  ])('fails closed on $name', async ({ response }) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (!response) throw new Error('offline')
      return response
    }))
    render()
    hooks.effects[0]()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await new Promise(resolve => setTimeout(resolve, 0))
    expectUnavailable()
  })

  it('opens lazily from the navbar, code actions, and shortcut only when enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ show: true, label: 'Ask docs' }) })))
    render()
    hooks.effects[0]()
    await vi.waitFor(() => expect(render()).toContain('Ask docs'))
    expect(render()).not.toContain('data-chat')
    actions.askAssistant('const answer = 42')
    expect(render()).toContain('const answer = 42')
    actions.openAssistant()
    expect(render()).toContain('<aside data-chat="true"></aside>')

    const cleanup = hooks.effects[2]()
    const listener = vi.mocked(document.addEventListener).mock.calls[0][1] as (event: unknown) => void
    const preventDefault = vi.fn()
    listener({ metaKey: true, key: 'i', preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(render()).toContain('data-chat')
    cleanup?.()
    expect(document.removeEventListener).toHaveBeenCalledWith('keydown', listener)
  })
})
