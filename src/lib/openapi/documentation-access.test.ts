/** Access-mode parity coverage for the generated documentation API contract. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isDocsAccessEnabledEdge: vi.fn(),
  getCloudAccessConfigEdge: vi.fn(),
  isCloudAccessConfiguredEdge: vi.fn(),
}))

vi.mock('@/lib/admin/auth-edge', () => ({
  isDocsAccessEnabledEdge: mocks.isDocsAccessEnabledEdge,
}))

vi.mock('@/lib/cloud-link/edge', () => ({
  getCloudAccessConfigEdge: mocks.getCloudAccessConfigEdge,
  isCloudAccessConfiguredEdge: mocks.isCloudAccessConfiguredEdge,
}))

import { resolveDocumentationAccessMode } from '@/lib/openapi/documentation-access'

describe('resolveDocumentationAccessMode', () => {
  beforeEach(() => {
    mocks.isDocsAccessEnabledEdge.mockReset().mockReturnValue(false)
    mocks.getCloudAccessConfigEdge.mockReset().mockResolvedValue(null)
    mocks.isCloudAccessConfiguredEdge.mockReset().mockReturnValue(false)
  })

  it('matches locally configured password protection', async () => {
    mocks.isDocsAccessEnabledEdge.mockReturnValue(true)

    await expect(
      resolveDocumentationAccessMode('https://docs.example.com'),
    ).resolves.toBe('password')
    expect(mocks.getCloudAccessConfigEdge).not.toHaveBeenCalled()
  })

  it('matches managed password protection', async () => {
    mocks.getCloudAccessConfigEdge.mockResolvedValue({
      access: { mode: 'password' },
    })

    await expect(
      resolveDocumentationAccessMode('https://docs.example.com'),
    ).resolves.toBe('password')
  })

  it('keeps public sites anonymous', async () => {
    mocks.getCloudAccessConfigEdge.mockResolvedValue({
      access: { mode: 'public' },
    })

    await expect(
      resolveDocumentationAccessMode('https://docs.example.com'),
    ).resolves.toBe('public')
  })

  it('fails closed when a managed Cloud access grant is unavailable', async () => {
    mocks.isCloudAccessConfiguredEdge.mockReturnValue(true)

    await expect(
      resolveDocumentationAccessMode('https://docs.example.com'),
    ).resolves.toBe('password')
  })

  it('keeps self-hosted sites public when no access policy is configured', async () => {
    await expect(
      resolveDocumentationAccessMode('https://docs.example.com'),
    ).resolves.toBe('public')
  })
})
