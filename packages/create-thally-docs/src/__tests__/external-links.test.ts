/** `thally check --external`: bounded, public-only, warning-level link checks. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { runCheck } from '../check.js'
import {
  checkExternalLinks,
  checkableUrl,
  isPublicAddress,
  type ExternalLinkRequester,
  type ResolvedAddress,
} from '../external-links.js'

const publicHost = async (): Promise<Array<ResolvedAddress>> => [{ address: '93.184.215.14', family: 4 }]

describe('external link targets', () => {
  it('skips loopback, private, credentialed, and non-http links before any lookup', () => {
    for (const value of [
      'http://localhost:3040/x',
      'http://127.0.0.1/admin',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://169.254.169.254/latest/meta-data',
      'https://user:secret@example.com/',
      'http://intranet/',
      'http://printer.local/',
      'ftp://example.com/file',
    ]) {
      expect(checkableUrl(value), value).toBeNull()
    }
    expect(checkableUrl('https://docs.example.com/page#section')?.toString()).toBe('https://docs.example.com/page')
  })

  it('classifies only global unicast addresses as public', () => {
    expect(isPublicAddress('93.184.215.14', 4)).toBe(true)
    expect(isPublicAddress('192.168.1.1', 4)).toBe(false)
    expect(isPublicAddress('100.64.0.1', 4)).toBe(false)
    expect(isPublicAddress('2606:4700::1', 6)).toBe(true)
    expect(isPublicAddress('fd00::1', 6)).toBe(false)
    expect(isPublicAddress('::ffff:127.0.0.1', 6)).toBe(false)
  })
})

describe('checkExternalLinks', () => {
  it('reports broken links as warnings and treats redirects and auth walls as fine', async () => {
    const statuses: Record<string, number> = {
      'https://ok.example.com/': 200,
      'https://moved.example.com/': 301,
      'https://gone.example.com/': 404,
      'https://private.example.com/': 403,
    }
    const request: ExternalLinkRequester = async (url) => statuses[url.toString()] ?? 500
    const issues = await checkExternalLinks([
      { url: 'https://ok.example.com/', file: 'a.mdx', line: 1 },
      { url: 'https://moved.example.com/', file: 'a.mdx', line: 2 },
      { url: 'https://gone.example.com/', file: 'a.mdx', line: 3 },
      { url: 'https://gone.example.com/#frag', file: 'b.mdx', line: 9 },
      { url: 'https://private.example.com/', file: 'a.mdx', line: 4 },
    ], { resolve: publicHost, request })
    expect(issues).toEqual([
      { severity: 'warning', message: 'External link "https://gone.example.com/" returned HTTP 404', file: 'a.mdx', line: 3 },
      { severity: 'warning', message: 'External link "https://gone.example.com/#frag" returned HTTP 404', file: 'b.mdx', line: 9 },
    ])
  })

  it('never contacts a name that resolves to a non-public address', async () => {
    const request = vi.fn<ExternalLinkRequester>(async () => 200)
    const issues = await checkExternalLinks(
      [{ url: 'https://rebind.example.com/', file: 'a.mdx' }],
      { resolve: async () => [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }], request },
    )
    expect(issues).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })

  it('pins the request to the validated address and falls back to GET on 405', async () => {
    const calls: Array<[string, string]> = []
    const request: ExternalLinkRequester = async (_url, method, pinned) => {
      calls.push([method, pinned.address])
      return method === 'HEAD' ? 405 : 200
    }
    await expect(checkExternalLinks([{ url: 'https://head.example.com/', file: 'a.mdx' }], { resolve: publicHost, request })).resolves.toEqual([])
    expect(calls).toEqual([['HEAD', '93.184.215.14'], ['GET', '93.184.215.14']])
  })

  it('reports unreachable hosts and timeouts', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    const issues = await checkExternalLinks([
      { url: 'https://slow.example.com/', file: 'a.mdx' },
      { url: 'https://nxdomain.example.com/', file: 'a.mdx' },
    ], {
      timeoutMs: 50,
      resolve: async (host) => {
        if (host.startsWith('nxdomain')) throw new Error('ENOTFOUND')
        return publicHost()
      },
      request: async () => { throw timeout },
    })
    expect(issues.map((issue) => issue.message)).toEqual([
      'External link "https://slow.example.com/" timed out after 50ms',
      'External link "https://nxdomain.example.com/" host "nxdomain.example.com" did not resolve',
    ])
  })

  it('caps unique URLs and respects the concurrency limit', async () => {
    let active = 0
    let peak = 0
    const request: ExternalLinkRequester = async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return 200
    }
    const references = Array.from({ length: 12 }, (_, index) => ({ url: `https://site${index}.example.com/`, file: 'a.mdx' }))
    const issues = await checkExternalLinks(references, { resolve: publicHost, request, concurrency: 3, maxUrls: 10 })
    expect(peak).toBeLessThanOrEqual(3)
    expect(issues).toEqual([{ severity: 'warning', message: 'Checked the first 10 of 12 unique external links; the rest were not checked.' }])
  })
})

describe('thally check --external', () => {
  it('checks external links only when requested and never fails the check', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-external-'))
    mkdirSync(join(projectDir, 'src/content'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
      tabs: [{ tab: 'Guides', groups: [{ group: 'Start', pages: ['introduction'] }] }],
    }))
    writeFileSync(join(projectDir, 'src/content/introduction.mdx'), [
      '---',
      'title: Introduction',
      'description: Overview page.',
      '---',
      '',
      'Read the [vendor guide](https://vendor.example.com/missing) for more detail on this topic.',
    ].join('\n'))
    const request = vi.fn<ExternalLinkRequester>(async () => 404)
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      await expect(runCheck(projectDir, { fix: false, ci: true })).resolves.toBe(0)
      expect(request).not.toHaveBeenCalled()
      await expect(runCheck(projectDir, {
        fix: false,
        ci: true,
        external: true,
        externalLinkOptions: { resolve: publicHost, request },
      })).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
    expect(request).toHaveBeenCalledTimes(1)
    expect(output.join('\n')).toContain('::warning file=src/content/introduction.mdx,line=6::External link "https://vendor.example.com/missing" returned HTTP 404')
  })
})
