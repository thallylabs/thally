/**
 * Acceptance smoke suite for the OpenNext Worker under real workerd.
 *
 * With THALLY_CLOUDFLARE_SMOKE_URL set, this checks an already-running preview
 * or deployment. Otherwise it starts the locally built Worker on an ephemeral
 * port and tears down only that child process when checks finish.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'

interface SmokeCheck {
  name: string
  path: string
  init?: RequestInit
  contentType?: string
  validateHydrationBootstrap?: boolean
}

const checks: ReadonlyArray<SmokeCheck> = [
  {
    name: 'home',
    path: '/',
    contentType: 'text/html',
    validateHydrationBootstrap: true,
  },
  { name: 'guide', path: '/guides/deploying', contentType: 'text/html' },
  { name: 'docs index', path: '/api/docs-index', contentType: 'application/json' },
  {
    name: 'structured document',
    path: '/api/docs/introduction?format=json',
    contentType: 'application/json',
  },
  { name: 'search', path: '/api/search?q=Thally', contentType: 'application/json' },
  { name: 'OpenAPI', path: '/openapi.yaml' },
  { name: 'complete LLM corpus', path: '/llms-full.txt', contentType: 'text/plain' },
  { name: 'agent guidance', path: '/AGENTS.md', contentType: 'text/markdown' },
  {
    name: 'source Markdown',
    path: '/api/markdown/introduction',
    contentType: 'text/markdown',
  },
  {
    name: 'cloud handshake',
    path: '/api/cloud/handshake',
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    contentType: 'application/json',
  },
  { name: 'Open Graph image', path: '/api/og?title=Worker', contentType: 'image/png' },
]

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitForPreview(baseUrl: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Cloudflare preview exited before becoming ready.\n${output()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/robots.txt`)
      if (response.ok) return
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Cloudflare preview did not become ready.\n${output()}`)
}

async function stopPreview(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const signal = (name: NodeJS.Signals) => {
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, name)
        return
      } catch {
        // Fall back to signaling the direct child if its process group ended.
      }
    }
    child.kill(name)
  }
  signal('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null) signal('SIGKILL')
}

async function main(): Promise<void> {
  const configuredUrl = process.env.THALLY_CLOUDFLARE_SMOKE_URL?.replace(/\/$/, '')
  let child: ChildProcess | null = null
  let output = ''
  let baseUrl = configuredUrl

  if (!baseUrl) {
    const port = await availablePort()
    baseUrl = `http://127.0.0.1:${port}`
    const binary = path.join(process.cwd(), 'node_modules/.bin/opennextjs-cloudflare')
    child = spawn(binary, ['preview', '--port', String(port)], {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-12_000)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    await waitForPreview(baseUrl, child, () => output)
  }

  try {
    for (const check of checks) {
      const response = await fetch(`${baseUrl}${check.path}`, check.init)
      if (!response.ok) {
        throw new Error(`${check.name} returned ${response.status}.`)
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (check.contentType && !contentType.includes(check.contentType)) {
        throw new Error(
          `${check.name} returned ${contentType || 'no content type'}; expected ${check.contentType}.`,
        )
      }
      if (check.validateHydrationBootstrap) {
        const html = await response.text()
        const shimIndex = html.indexOf('globalThis.__name')
        const transformedCallIndex = html.indexOf('__name(')
        if (shimIndex < 0 || (transformedCallIndex >= 0 && shimIndex > transformedCallIndex)) {
          throw new Error(
            `${check.name} does not define the runtime name helper before transformed inline scripts.`,
          )
        }
      } else {
        await response.arrayBuffer()
      }
      console.log(`[cloudflare-smoke] ${check.name}: ${response.status}`)
    }
  } finally {
    if (child) await stopPreview(child)
  }
}

void main()
