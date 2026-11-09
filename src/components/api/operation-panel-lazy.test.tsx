/** A page that lists more rows than it renders up front mounts nested levels when opened, or when a link to a field asks. */

// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'
import { packValue } from '@/lib/openapi/pack-operation'

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

/** `groups` objects of `fields` fields each, one level deeper than the page's first. */
function schemaOf(groups: number, fields: number) {
  const names = (prefix: string, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i}`, { type: 'string', description: `${prefix}${i} text` }]))
  return {
    type: 'object',
    properties: Object.fromEntries(Array.from({ length: groups }, (_, g) => [`g${g}`, { type: 'object', properties: { ...names('h', fields), inner: { type: 'object', properties: names('leaf', 2) } } }])),
  }
}

const operationWith = (schema: Record<string, unknown>) => {
  const content = { 'application/json': { schema } }
  return operationFrom({
    openapi: '3.1.0', info: { title: 'T', version: '1' },
    paths: { '/things': { post: { requestBody: { content }, responses: { '200': { description: 'ok', content } } } } },
  })
}

const small = () => operationWith(schemaOf(3, 3))
const large = () => operationWith(schemaOf(25, 25))

async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

async function mount(operation = large()): Promise<void> {
  await act(async () => { root.render(<OperationPanel operation={packValue(operation)} playground="simple" />) })
  await settle()
}

const has = (id: string) => document.getElementById(id) !== null
const expanded = (name: string) => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === `${name} properties`)?.getAttribute('aria-expanded')

describe('a page with few rows', () => {
  it('renders every level up front, collapsed ones hidden, as before', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={small()} playground="simple" />)
    expect(html).toContain('id="body-g2-h2"')
    expect(html).toContain('id="body-g2-inner-leaf1"')
  })

  it('renders the same from a packed operation', () => {
    expect(renderToStaticMarkup(<OperationPanel operation={packValue(small())} playground="simple" />)).toBe(renderToStaticMarkup(<OperationPanel operation={small()} playground="simple" />))
  })
})

describe('a page with more rows than it renders up front', () => {
  it('leaves the fields under a collapsed row out of the page, and keeps the first level and the toggle', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={large()} playground="simple" />)
    expect(html).toContain('id="body-g24"')
    expect(html).toContain('g24 properties')
    expect(html).not.toContain('id="body-g24-h0"')
    // 25 groups of 27 rows in the body and again in the response would be over 1,300 rows, and far more with their markup.
    expect(html.length).toBeLessThan(250_000)
  })

  it('mounts a level when its toggle is opened, and the one below it stays out until then', async () => {
    await mount()
    expect(has('body-g3-h0')).toBe(false)
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')[3].click() })
    expect(expanded('g3')).toBe('true')
    expect(has('body-g3-h24')).toBe(true)
    expect(has('body-g3-inner-leaf0')).toBe(false)
    expect(has('body-g4-h0')).toBe(false)
  })

  it.each([true, false])('opens the rows around a linked nested field, mounts it and scrolls to it (initial hash: %s)', async (initial) => {
    const hash = '#body-g3-inner-leaf1'
    if (initial) window.location.hash = hash
    await mount()
    if (!initial) {
      await act(async () => {
        window.location.hash = hash
        window.dispatchEvent(new Event('hashchange'))
      })
      await settle()
    }
    expect(expanded('g3')).toBe('true')
    expect(expanded('inner')).toBe('true')
    expect(scrolled).toContainEqual({ id: 'body-g3-inner-leaf1', hidden: false })
    expect(has('body-g4-h0')).toBe(false)
  })

  it('leaves everything closed for a hash that names nothing in the schema', async () => {
    window.location.hash = '#elsewhere'
    await mount()
    expect(expanded('g0')).toBe('false')
    expect(scrolled).toEqual([])
  })
})
