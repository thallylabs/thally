/** Regression coverage for the optional public Markdown page projection. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudSiteConfig: vi.fn(),
  read: vi.fn(),
}))

vi.mock('@/lib/cloud-link/client', () => ({
  getCloudSiteConfig: mocks.getCloudSiteConfig,
}))

vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({ read: mocks.read }),
}))

import { GET } from './route'

function request(path: string): Request {
  return new Request(`https://docs.example.com${path}`)
}

describe('GET /api/markdown/[...slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudSiteConfig.mockResolvedValue({
      siteConfig: {
        portable: { markdown: { enabled: true } },
        access: { mode: 'public', passwordHash: null },
      },
    })
    mocks.read.mockResolvedValue({
      content: '---\ntitle: Guide\n---\n\n# Guide\n\n<Note>Read this.</Note>',
    })
  })

  it('returns the active content source as Markdown when enabled', async () => {
    const response = await GET(request('/api/markdown/guide'), {
      params: Promise.resolve({ slug: ['guide'] }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(await response.text()).toContain('# Guide')
    expect(mocks.read).toHaveBeenCalledWith('src/content/guide.mdx')
  })

  it('returns 404 before reading content when disabled', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue({
      siteConfig: {
        portable: { markdown: { enabled: false } },
        access: { mode: 'public', passwordHash: null },
      },
    })

    const response = await GET(request('/api/markdown/guide'), {
      params: Promise.resolve({ slug: ['guide'] }),
    })

    expect(response.status).toBe(404)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('serves markdown when Cloud has no setting, following the repository default', async () => {
    mocks.getCloudSiteConfig.mockResolvedValue(null)

    const response = await GET(request('/api/markdown/guide'), {
      params: Promise.resolve({ slug: ['guide'] }),
    })

    // The scaffold enables `.md` mirrors by default; sites opt out through
    // docs.json or the Cloud portable override (covered above).
    expect(response.status).toBe(200)
    expect(mocks.read).toHaveBeenCalledWith('src/content/guide.mdx')
  })
})
