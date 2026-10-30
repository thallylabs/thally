/** Exercise real clipboard, installation payloads, capability failure and keyboard navigation. */
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ pathname: '/guide' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
import { CopyPageButton } from './copy-page-button'

let root: Root
let container: HTMLElement
const fetchMock = vi.fn()
const writeText = vi.fn()
const fiveActions = ['copy', 'llms-full', 'mcp', 'cursor', 'vscode']

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  document.body.innerHTML = '<div id="root"></div><article>Rendered fallback</article>'
  container = document.getElementById('root')!
  root = createRoot(container)
  route.pathname = '/guide'
  fetchMock.mockReset().mockImplementation(async (url: string) => url === '/api/site-config'
    ? new Response(JSON.stringify({ mcpEnabled: true })) : new Response('# Current page'))
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

async function render(options?: Array<string>, markdown?: string) {
  await act(async () => { root.render(<CopyPageButton options={options} serverName="tenant-docs" markdown={markdown} />) })
}
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}
async function key(element: Element, value: string) {
  await act(async () => { element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })) })
}
function trigger() { return container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')! }
function menuItems() { return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]')) }
function item(label: string) { return menuItems().find((entry) => entry.querySelector('span.font-medium')?.textContent === label)! }
async function open() { await click(trigger()) }

describe('reader page actions', () => {
  it('keeps default actions and copy available inside the dropdown', async () => {
    await render()
    expect(fetchMock).not.toHaveBeenCalled()
    await open()
    expect(menuItems().map((entry) => entry.querySelector('span.font-medium')?.textContent)).toEqual(['Copy page', 'View as Markdown', 'Open in ChatGPT', 'Open in Claude', 'Open in Perplexity'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['/', '/guides/advanced', '/api/default/messages/post'])('copies the current Markdown at %s', async (pathname) => {
    route.pathname = pathname
    await render(fiveActions)
    await click(container.querySelector('[aria-label="Copy page as markdown"]')!)
    expect(fetchMock).toHaveBeenCalledWith(pathname === '/' ? '/introduction.md' : `${pathname}.md`)
    expect(writeText).toHaveBeenCalledWith('# Current page')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied to clipboard')
  })

  it('copies canonical generated API Markdown without requesting a nonexistent mirror', async () => {
    route.pathname = '/api/default/posts/post'
    await render(fiveActions, '## POST /posts — Create post\n\nRequest body (application/json): title, body\n\nResponses: 201 Created')
    await click(container.querySelector('[aria-label="Copy page as markdown"]')!)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Request body (application/json): title, body'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Responses: 201 Created'))
  })

  it('snapshots fallback content before a slow mirror response and excludes menu controls', async () => {
    let resolveMirror!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveMirror = resolve }))
    document.querySelector('article')!.append(container)
    await render(['copy', 'view'])
    await open()
    await click(item('Copy page'))
    await open()
    document.querySelector('article')!.append('Later page content')
    await act(async () => { resolveMirror(new Response('', { status: 404 })) })
    expect(writeText).toHaveBeenCalledWith('Rendered fallback')
  })

  it('uses the rendered article if the Markdown mirror is disabled', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    Object.defineProperty(document.querySelector('article'), 'innerText', { configurable: true, value: 'Rendered fallback' })
    await render(['copy'])
    await open()
    await click(item('Copy page'))
    expect(writeText).toHaveBeenCalledWith('Rendered fallback')
  })

  it('reports clipboard failure without claiming success', async () => {
    writeText.mockRejectedValue(new Error('Clipboard denied'))
    await render(['copy'])
    await click(container.querySelector('[aria-label="Copy page as markdown"]')!)
    expect(container.textContent).toContain("Couldn't copy")
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Couldn't copy")
  })

  it('builds each configured action for this origin and decodes official editor payloads', async () => {
    await render(fiveActions)
    await open()
    expect(menuItems().map((entry) => entry.querySelector('span.font-medium')?.textContent)).toEqual(['Copy page', 'llms-full.txt', 'Copy MCP install command', 'Connect to Cursor', 'Connect to VS Code'])
    const origin = window.location.origin
    const endpoint = `${origin}/api/mcp`
    expect(item('llms-full.txt').getAttribute('href')).toBe(`${origin}/llms-full.txt`)
    const cursor = new URL(item('Connect to Cursor').getAttribute('href')!)
    expect(cursor.protocol).toBe('cursor:')
    expect(cursor.hostname).toBe('anysphere.cursor-deeplink')
    expect(cursor.searchParams.get('name')).toBe('tenant-docs')
    expect(JSON.parse(atob(cursor.searchParams.get('config')!))).toEqual({ url: endpoint })
    const vscode = item('Connect to VS Code').getAttribute('href')!
    expect(vscode.startsWith('vscode:mcp/install?')).toBe(true)
    expect(JSON.parse(decodeURIComponent(vscode.split('?')[1]))).toEqual({ name: 'tenant-docs', type: 'http', url: endpoint })
    await click(item('Copy MCP install command'))
    expect(writeText).toHaveBeenCalledWith(`npx -y add-mcp ${endpoint}`)
    expect(document.activeElement).toBe(trigger())
  })

  it.each(['disabled', 'failed', 'malformed'])('hides unavailable MCP actions when capability is %s', async (kind) => {
    fetchMock.mockImplementation(async () => {
      if (kind === 'failed') throw new Error('Offline')
      return new Response(JSON.stringify(kind === 'disabled' ? { mcpEnabled: false } : { mcpEnabled: 'true' }))
    })
    await render(fiveActions)
    await open()
    expect(menuItems().map((entry) => entry.querySelector('span.font-medium')?.textContent)).toEqual(['Copy page', 'llms-full.txt'])
  })

  it('checks capability again when reopening after MCP is disabled', async () => {
    await render(fiveActions)
    await open()
    expect(item('Connect to Cursor')).toBeTruthy()
    await key(document.activeElement!, 'Escape')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mcpEnabled: false })))
    await open()
    expect(item('Connect to Cursor')).toBeUndefined()
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/site-config')).toHaveLength(2)
  })

  it('keeps MCP hidden while capability is pending and cancels a closed-menu request', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    await render(fiveActions)
    await open()
    expect(menuItems()).toHaveLength(2)
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await key(document.activeElement!, 'Escape')
    expect(signal.aborted).toBe(true)
    expect(document.activeElement).toBe(trigger())
  })

  it.each([[[]], [['unknown']]])('does not render an empty menu for options %j', async (options) => {
    await render(options)
    expect(trigger()).toBeNull()
  })

  it('focuses a MCP-only menu after capability arrives without stealing an existing item focus', async () => {
    let resolveCapability!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveCapability = resolve }))
    await render(['mcp', 'cursor'])
    await open()
    expect(menuItems()).toHaveLength(0)
    await act(async () => { resolveCapability(new Response(JSON.stringify({ mcpEnabled: true }))) })
    expect(document.activeElement).toBe(item('Copy MCP install command'))
  })

  it('removes a MCP-only menu when the endpoint is disabled', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mcpEnabled: false })))
    await render(['mcp', 'cursor', 'vscode'])
    await open()
    expect(trigger()).toBeNull()
  })

  it('supports first/last/wrapping focus, Escape, and tab exit', async () => {
    await render(['copy', 'view', 'chatgpt'])
    trigger().focus()
    await key(trigger(), 'ArrowUp')
    expect(document.activeElement).toBe(item('Open in ChatGPT'))
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement).toBe(item('Copy page'))
    await key(document.activeElement!, 'End')
    expect(document.activeElement).toBe(item('Open in ChatGPT'))
    await key(document.activeElement!, 'Home')
    expect(document.activeElement).toBe(item('Copy page'))
    await key(document.activeElement!, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    await key(trigger(), 'ArrowDown')
    await key(document.activeElement!, 'Tab')
    expect(document.activeElement).toBe(trigger())
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
