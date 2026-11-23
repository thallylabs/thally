/** Public capability projection must never serialize the admin settings record. */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ mcpEnabled: null as boolean | null, logo: false, darkLogo: false }))
vi.mock('@/lib/brand-assets', () => ({ resolveBrandAsset: async (_kind: string, mode: string) =>
  (mode === 'dark' ? state.darkLogo : state.logo) ? { dataUri: 'private-upload-bytes' } : null }))
vi.mock('@/lib/admin/site-config', () => ({ getEffectiveSiteConfig: async () => ({ name: 'Tenant', description: 'Docs', repoUrl: '' }) }))
vi.mock('@/lib/admin/settings', () => ({ getAdminSettings: async () => ({ mcpEnabled: state.mcpEnabled, chatKeyEnc: 'never-public', docsPasswordHash: 'never-public' }) }))
import { GET } from './route'
beforeEach(() => { state.mcpEnabled = null; state.logo = false; state.darkLogo = false })
describe('public site capabilities', () => {
  it('projects logo availability without exposing uploaded bytes', async () => {
    state.logo = true
    state.darkLogo = true
    const response = await GET(new NextRequest('https://tenant.example/api/site-config'))
    const body = await response.json()
    expect(body.logos).toEqual({ light: true, dark: true })
    expect(JSON.stringify(body)).not.toContain('private-upload-bytes')
  })
  it.each([true, false, null])('projects MCP policy %s without settings or secrets', async (policy) => {
    state.mcpEnabled = policy
    const response = await GET(new NextRequest('https://tenant.example/api/site-config'))
    expect(await response.json()).toEqual({ name: 'Tenant', description: 'Docs', repoUrl: '', mcpEnabled: policy !== false, logos: { light: false, dark: false } })
    expect(response.headers.get('cache-control')).toBe('public, max-age=30')
  })
})
