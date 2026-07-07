import { describe, expect, it } from 'vitest'
import { isMachineEndpoint } from '@/lib/agent-endpoints'

describe('isMachineEndpoint', () => {
  it('treats discovery + API + static endpoints as terminal (no rewrite)', () => {
    const terminal = [
      '/ai.txt',
      '/llms.txt',
      '/.well-known/llms.txt',
      '/llms-full.txt',
      '/api/docs-index',
      '/api/docs/guides/auth',
      '/api/search',
      '/sitemap.xml',
      '/robots.txt',
      '/openapi.json',
      '/openapi.yaml',
      '/changelog/rss.xml',
      '/icon',
      '/images/diagram.png',
    ]
    for (const p of terminal) expect(isMachineEndpoint(p)).toBe(true)
  })

  it('treats human-facing doc routes as rewritable (not terminal)', () => {
    const docs = ['/', '/quickstart', '/guides/authentication', '/api']
    for (const p of docs) expect(isMachineEndpoint(p)).toBe(false)
  })
})
