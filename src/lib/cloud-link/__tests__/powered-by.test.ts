/** Request policy cannot trust stale snapshots or browser-provided removal. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldShowPoweredBy } from '../powered-by'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  connection: vi.fn(),
  getCloudSiteConfig: vi.fn(),
  getRequestOrigin: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/server', () => ({ connection: mocks.connection }))
vi.mock('../client', () => ({ getCloudSiteConfig: mocks.getCloudSiteConfig }))
vi.mock('../request', () => ({ getRequestOrigin: mocks.getRequestOrigin }))

beforeEach(() => {
  vi.resetAllMocks()
  for (const name of ['THALLY_CLOUD_SITE_CONFIG', 'DOX_CLOUD_SITE_CONFIG', 'THALLY_CLOUD_SITE_TOKEN', 'DOX_CLOUD_SITE_TOKEN', 'THALLY_CONTENT_SOURCE']) {
    vi.stubEnv(name, undefined)
  }
  mocks.headers.mockResolvedValue(new Headers())
  mocks.getRequestOrigin.mockResolvedValue('https://docs.example.com')
})
afterEach(() => vi.unstubAllEnvs())

describe('Powered by Thally server policy', () => {
  it('keeps OSS static and ignores forged removal headers without managed configuration', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-thally-powered-by': 'off' }))
    await expect(shouldShowPoweredBy()).resolves.toBe(true)
    expect(mocks.headers).not.toHaveBeenCalled()
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.getCloudSiteConfig).not.toHaveBeenCalled()
  })

  it('opts assets builds into request rendering without granting header authority', async () => {
    vi.stubEnv('THALLY_CONTENT_SOURCE', 'assets')
    mocks.headers.mockResolvedValue(new Headers({ 'x-thally-powered-by': 'off' }))
    await expect(shouldShowPoweredBy()).resolves.toBe(true)
    expect(mocks.headers).toHaveBeenCalledOnce()
    mocks.headers.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
    await expect(shouldShowPoweredBy()).rejects.toThrow('DYNAMIC_SERVER_USAGE')
  })

  it.each(['THALLY_CLOUD_SITE_CONFIG', 'DOX_CLOUD_SITE_CONFIG'])('uses trusted live policy despite malformed %s', async (name) => {
    vi.stubEnv(name, '{bad-json')
    mocks.headers.mockResolvedValue(new Headers({ 'x-thally-powered-by': 'off' }))
    await expect(shouldShowPoweredBy()).resolves.toBe(false)
    expect(mocks.getCloudSiteConfig).not.toHaveBeenCalled()
  })

  it.each([undefined, 'on', 'false', 'OFF', ''])('retains the mark for missing/invalid policy %s, ignoring stale paid snapshots', async (policy) => {
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', JSON.stringify({ entitlements: { plan: 'cloud' }, siteConfig: { portable: { branding: { showPoweredBy: false } } } }))
    mocks.headers.mockResolvedValue(new Headers(policy === undefined ? {} : { 'x-thally-powered-by': policy }))
    await expect(shouldShowPoweredBy()).resolves.toBe(true)
  })

  it('treats an empty managed binding as managed and never trusts the snapshot', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', '')
    await expect(shouldShowPoweredBy()).resolves.toBe(true)
    expect(mocks.headers).toHaveBeenCalledOnce()
  })

  it('lets Next observe managed prerender bailouts', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_CONFIG', '{}')
    mocks.headers.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
    await expect(shouldShowPoweredBy()).rejects.toThrow('DYNAMIC_SERVER_USAGE')
  })

  it.each([
    ['free', false, true],
    ['cloud', false, false],
    ['enterprise', false, false],
    ['cloud', true, true],
    ['cloud', undefined, true],
    [undefined, false, true],
    ['unknown', false, true],
  ])('resolves external plan %s setting %s to shown=%s', async (plan, setting, expected) => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'test-token')
    mocks.headers.mockResolvedValue(new Headers({ 'x-thally-powered-by': 'off' }))
    mocks.getCloudSiteConfig.mockResolvedValue({ entitlements: { plan }, siteConfig: { portable: { branding: { showPoweredBy: setting } } } })
    await expect(shouldShowPoweredBy()).resolves.toBe(expected)
    expect(mocks.connection).toHaveBeenCalledOnce()
    expect(mocks.getCloudSiteConfig).toHaveBeenCalledWith('https://docs.example.com', { fresh: true })
    expect(mocks.headers).not.toHaveBeenCalled()
  })

  it.each([null, new Error('offline')])('retains attribution when external authority fails: %s', async (result) => {
    vi.stubEnv('DOX_CLOUD_SITE_TOKEN', 'legacy-token')
    if (result instanceof Error) mocks.getCloudSiteConfig.mockRejectedValue(result)
    else mocks.getCloudSiteConfig.mockResolvedValue(result)
    await expect(shouldShowPoweredBy()).resolves.toBe(true)
  })

  it('lets Next observe external prerender bailouts', async () => {
    vi.stubEnv('THALLY_CLOUD_SITE_TOKEN', 'test-token')
    mocks.connection.mockRejectedValue(new Error('DYNAMIC_SERVER_USAGE'))
    await expect(shouldShowPoweredBy()).rejects.toThrow('DYNAMIC_SERVER_USAGE')
  })
})
