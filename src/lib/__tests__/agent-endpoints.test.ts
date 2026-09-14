import { describe, expect, it } from 'vitest'
import {
  isAgentDiscoveryEndpoint,
  isContentBearingAgentEndpoint,
  isMachineEndpoint,
  isPublicAgentEndpoint,
} from '@/lib/agent-endpoints'

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

describe('docs-access endpoint classification', () => {
  it.each([
    '/robots.txt',
    '/ai.txt',
    '/skill.md',
    '/auth.md',
    '/.well-known/mcp.json',
    '/.well-known/oauth-protected-resource',
  ])('keeps non-content discovery public: %s', (path) => {
    expect(isPublicAgentEndpoint(path)).toBe(true)
    expect(isContentBearingAgentEndpoint(path)).toBe(false)
  })

  it.each([
    '/llms.txt',
    '/llms-full.txt',
    '/.well-known/llms.txt',
    '/AGENTS.md',
    '/sitemap.xml',
    '/openapi.json',
    '/openapi.yaml',
    '/changelog/rss.xml',
    '/guides/private.md',
    '/api/docs-index',
    '/api/docs/guides/private',
    '/api/markdown/guides/private',
    '/api/search',
    '/api/mcp',
    '/api/agent-readiness',
  ])('gates content-bearing machine surface: %s', (path) => {
    expect(isPublicAgentEndpoint(path)).toBe(false)
    expect(isContentBearingAgentEndpoint(path)).toBe(true)
  })

  it('keeps access policy separate from analytics discovery classification', () => {
    expect(isAgentDiscoveryEndpoint('/llms-full.txt')).toBe(true)
    expect(isPublicAgentEndpoint('/llms-full.txt')).toBe(false)
    expect(isAgentDiscoveryEndpoint('/api/docs/private')).toBe(false)
    expect(isAgentDiscoveryEndpoint('/guides/private.md')).toBe(false)
  })
})
