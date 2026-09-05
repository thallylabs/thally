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

interface PageRepresentation {
  accept: string
  contentType: string
  bodyFormat: 'html' | 'markdown' | 'json'
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

const pageRepresentations: ReadonlyArray<PageRepresentation> = [
  { accept: '*/*', contentType: 'text/html', bodyFormat: 'html' },
  { accept: 'text/html', contentType: 'text/html', bodyFormat: 'html' },
  { accept: 'text/markdown', contentType: 'text/markdown', bodyFormat: 'markdown' },
  { accept: 'application/json', contentType: 'application/json', bodyFormat: 'json' },
  { accept: 'application/ld+json', contentType: 'application/ld+json', bodyFormat: 'json' },
]

/** Keep every advertised path pinned to the explicitly selected smoke origin. */
function smokeUrl(baseUrl: string, pathAndSearch: string): URL {
  const targetUrl = new URL(baseUrl)
  const queryIndex = pathAndSearch.indexOf('?')
  targetUrl.pathname = queryIndex === -1 ? pathAndSearch : pathAndSearch.slice(0, queryIndex)
  targetUrl.search = queryIndex === -1 ? '' : pathAndSearch.slice(queryIndex)
  return targetUrl
}

/** Verify each canonical page advertised by llms.txt through real workerd. */
async function verifyLlmsPageMatrix(baseUrl: string): Promise<void> {
  const indexResponse = await fetch(`${baseUrl}/llms.txt`)
  if (!indexResponse.ok) throw new Error(`llms.txt returned ${indexResponse.status}.`)
  const body = await indexResponse.text()
  const documentationUrl = body.match(/^- Documentation: (https?:\/\/\S+)$/m)?.[1]
  if (!documentationUrl) throw new Error('llms.txt did not advertise its documentation URL.')
  const advertisedOrigin = new URL(documentationUrl).origin
  const firstPartyPaths = Array.from(
    new Set(
      Array.from(body.matchAll(/https?:\/\/[^\s)>\]`]+/g), (match) => match[0])
        .map((url) => url.replace(/[.,;:]$/, ''))
        .filter((url) => new URL(url).origin === advertisedOrigin)
        .map((url) => {
          const resolvedUrl = new URL(
            url.replace('{page-id}', 'introduction').replace('{query}', 'Thally'),
          )
          return `${resolvedUrl.pathname}${resolvedUrl.search}`
        }),
    ),
  )
  const pagePaths = Array.from(
    body.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)]+)\)/gm),
    (match) => {
      const advertisedUrl = new URL(match[1])
      return `${advertisedUrl.pathname}${advertisedUrl.search}`
    },
  )

  if (pagePaths.length === 0) throw new Error('llms.txt did not emit any canonical page links.')

  for (const firstPartyPath of firstPartyPaths) {
    const targetUrl = smokeUrl(baseUrl, firstPartyPath)
    const response = await fetch(targetUrl, {
      headers: { Accept: '*/*' },
    })
    const expectedStatus = targetUrl.pathname === '/api/mcp' ? 405 : 200
    if (response.status !== expectedStatus) {
      throw new Error(
        `${firstPartyPath} returned ${response.status} for Accept: */*; expected ${expectedStatus}.`,
      )
    }
  }

  for (const pagePath of pagePaths) {
    const pageUrl = smokeUrl(baseUrl, pagePath).toString()
    for (const representation of pageRepresentations) {
      const response = await fetch(pageUrl, {
        headers: { Accept: representation.accept },
      })
      if (!response.ok) {
        throw new Error(`${pageUrl} returned ${response.status} for Accept: ${representation.accept}.`)
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes(representation.contentType)) {
        throw new Error(
          `${pageUrl} returned ${contentType || 'no content type'} for Accept: ${representation.accept}; expected ${representation.contentType}.`,
        )
      }
      const responseBody = await response.text()
      if (representation.bodyFormat === 'html' && !responseBody.includes('<!DOCTYPE html')) {
        throw new Error(`${pageUrl} declared HTML but did not serialize an HTML document.`)
      }
      if (representation.bodyFormat === 'markdown' && !responseBody.startsWith('---\n')) {
        throw new Error(`${pageUrl} declared Markdown but did not serialize Markdown frontmatter.`)
      }
      if (representation.bodyFormat === 'json') {
        try {
          JSON.parse(responseBody)
        } catch {
          throw new Error(`${pageUrl} declared JSON but did not serialize valid JSON.`)
        }
      }
    }
  }

  console.log(
    `[cloudflare-smoke] llms.txt matrix: ${firstPartyPaths.length} first-party link(s), ${pagePaths.length} canonical page(s)`,
  )
}

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
    await verifyLlmsPageMatrix(baseUrl)
  } finally {
    if (child) await stopPreview(child)
  }
}

void main()
