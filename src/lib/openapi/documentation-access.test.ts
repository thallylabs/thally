/** Access-mode parity coverage for the generated documentation API contract. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDocsAccessEnabledEdge: vi.fn(),
  getCloudAccessConfigEdge: vi.fn(),
}))

vi.mock('@/lib/admin/auth-edge', () => ({
  isDocsAccessEnabledEdge: mocks.isDocsAccessEnabledEdge,
}))

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: mocks.getCloudAccessConfigEdge,
}))

import { resolveDocumentationApiAccessMode } from '@/lib/openapi/documentation-access'

describe('resolveDocumentationApiAccessMode', () => {
  beforeEach(() => {
    mocks.isDocsAccessEnabledEdge.mockReset().mockReturnValue(false)
    mocks.getCloudAccessConfigEdge.mockReset().mockResolvedValue(null)
  })

  it('matches locally configured password protection', async () => {
    mocks.isDocsAccessEnabledEdge.mockReturnValue(true)

    await expect(
      resolveDocumentationApiAccessMode('https://docs.example.com'),
    ).resolves.toBe('password')
  })

  it('matches managed password protection', async () => {
    mocks.getCloudAccessConfigEdge.mockResolvedValue({
      access: { mode: 'password' },
    })

    await expect(
      resolveDocumentationApiAccessMode('https://docs.example.com'),
    ).resolves.toBe('password')
  })

  it('keeps public sites anonymous', async () => {
    mocks.getCloudAccessConfigEdge.mockResolvedValue({
      access: { mode: 'public' },
    })

    await expect(
      resolveDocumentationApiAccessMode('https://docs.example.com'),
    ).resolves.toBe('public')
  })
})
