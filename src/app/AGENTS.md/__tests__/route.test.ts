/** Request-bound agent guidance preserves published and authored overrides. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readActiveSource: vi.fn(),
  buildAgentsManifest: vi.fn(),
  resolveRequestSiteConfig: vi.fn(),
  siteIdentity: vi.fn(),
}))

vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'assets',
    read: mocks.readActiveSource,
  }),
}))

vi.mock('@/lib/agent-manifest', () => ({
  buildAgentsManifest: mocks.buildAgentsManifest,
}))

vi.mock('@/lib/site-config', () => ({
  resolveRequestSiteConfig: mocks.resolveRequestSiteConfig,
  siteIdentity: mocks.siteIdentity,
}))

import { GET } from '../route'

describe('GET /AGENTS.md', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveRequestSiteConfig.mockResolvedValue({ name: 'Customer Docs' })
    mocks.siteIdentity.mockReturnValue({ name: 'Customer Docs' })
    mocks.buildAgentsManifest.mockReturnValue('# Customer Docs\n')
  })

  it('prefers a published asset override in assets mode', async () => {
    mocks.readActiveSource.mockResolvedValue({
      content: '# Published agent guidance\n',
      modifiedAtMs: 1,
    })

    const response = await GET(new Request('https://docs.example.com/AGENTS.md'))

    expect(await response.text()).toBe('# Published agent guidance\n')
    expect(mocks.readActiveSource).toHaveBeenCalledWith('AGENTS.md')
    expect(mocks.buildAgentsManifest).not.toHaveBeenCalled()
  })

  it('generates request-identity guidance when no override exists', async () => {
    mocks.readActiveSource.mockResolvedValue(null)

    const response = await GET(new Request('https://docs.example.com/AGENTS.md'))

    expect(mocks.buildAgentsManifest).toHaveBeenCalledWith(
      { name: 'Customer Docs' },
      'https://docs.example.com',
    )
    expect(await response.text()).toBe('# Customer Docs\n')
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=86400')
  })
})
