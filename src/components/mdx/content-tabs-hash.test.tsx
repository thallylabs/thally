/** A link to a tab's id selects the tab, as the tab bar Mintlify renders does. */

// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Tab, Tabs } from '@/components/mdx/content-tabs'

let container: HTMLElement
let root: Root

beforeEach(() => {
  window.location.hash = ''
  document.body.innerHTML = '<div id="root"></div>'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.getElementById('root') as HTMLElement
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  vi.restoreAllMocks()
})

const page = (
  <>
    <Tabs>
      <Tab title="Solana" id="solana">solana-body</Tab>
      <Tab title="Bitcoin" id="bitcoin">bitcoin-body</Tab>
      <Tab title="No id">plain-body</Tab>
    </Tabs>
    <Tabs>
      <Tab title="Ton" id="ton">ton-body</Tab>
      <Tab title="Tron" id="tron">tron-body</Tab>
    </Tabs>
  </>
)

const selected = () => Array.from(container.querySelectorAll('[role="tab"]')).filter((tab) => tab.getAttribute('aria-selected') === 'true').map((tab) => tab.id)

async function mount(): Promise<void> {
  await act(async () => { root.render(page) })
}

async function go(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new Event('hashchange'))
  })
}

describe('Tabs and a #fragment', () => {
  it('puts the tab id on the tab button and names it as the label of its panel', async () => {
    await mount()
    const button = container.querySelector('#bitcoin')
    expect(button?.getAttribute('role')).toBe('tab')
    const panelId = button?.getAttribute('aria-controls') as string
    expect(container.querySelector(`[id="${panelId}"]`)?.getAttribute('aria-labelledby')).toBe('bitcoin')
  })

  it('selects the first tab when the page has no fragment', async () => {
    await mount()
    expect(selected()).toEqual(['solana', 'ton'])
  })

  it('selects the tab the fragment names on load', async () => {
    window.location.hash = '#bitcoin'
    await mount()
    expect(selected()).toEqual(['bitcoin', 'ton'])
    expect(container.textContent).toContain('bitcoin-body')
  })

  it('selects the tab when the fragment changes later, in the group that has it only', async () => {
    await mount()
    await go('#tron')
    expect(selected()).toEqual(['solana', 'tron'])
    await go('#bitcoin')
    expect(selected()).toEqual(['bitcoin', 'tron'])
  })

  it('leaves the tabs alone for a fragment that names none, or is not valid percent-encoding', async () => {
    await mount()
    await go('#bitcoin')
    await go('#nowhere')
    await go('#%E0%A4%A')
    expect(selected()).toEqual(['bitcoin', 'ton'])
  })
})
