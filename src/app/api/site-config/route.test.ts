/** Public capability projection must never serialize the admin settings record. */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ mcpEnabled: null as boolean | null }))
vi.mock('@/lib/admin/site-config', () => ({ getEffectiveSiteConfig: async () => ({ name: 'Tenant', description: 'Docs', repoUrl: '' }) }))
vi.mock('@/lib/admin/settings', () => ({ getAdminSettings: async () => ({ mcpEnabled: state.mcpEnabled, chatKeyEnc: 'never-public', docsPasswordHash: 'never-public' }) }))
import { GET } from './route'
beforeEach(() => { state.mcpEnabled = null })
describe('public site capabilities', () => {
  it.each([true, false, null])('projects MCP policy %s without settings or secrets', async (policy) => {
    state.mcpEnabled = policy
    const response = await GET(new NextRequest('https://tenant.example/api/site-config'))
    expect(await response.json()).toEqual({ name: 'Tenant', description: 'Docs', repoUrl: '', mcpEnabled: policy !== false })
    expect(response.headers.get('cache-control')).toBe('public, max-age=30')
  })
})
