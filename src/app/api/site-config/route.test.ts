/** Public image availability follows the existing resolver without exposing artwork or credentials. */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const resolve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/brand-assets', () => ({ resolveBrandAsset: resolve }))
vi.mock('@/lib/admin/site-config', () => ({ getEffectiveSiteConfig: async () => ({ name: 'Example', description: 'Docs', repoUrl: '' }) }))

beforeEach(() => resolve.mockReset())

describe('public logo availability', () => {
  it('reports absent or disabled logos without exposing a custom URL', async () => {
    resolve.mockResolvedValueOnce(null).mockResolvedValueOnce({ disabled: true })
    const data = await (await GET(new NextRequest('https://docs.example/api/site-config'))).json()
    expect(data.logoAvailability).toEqual({ light: false, dark: false })
    expect(resolve).toHaveBeenCalledWith('logo', 'dark', 'https://docs.example')
  })

  it('reports authored and uploaded artwork as booleans only', async () => {
    resolve.mockResolvedValueOnce({ path: '/logo.svg' }).mockResolvedValueOnce({ dataUri: 'data:image/png;base64,private-bytes' })
    const data = await (await GET(new NextRequest('https://docs.example/api/site-config'))).json()
    expect(data).toEqual({ name: 'Example', description: 'Docs', repoUrl: '', logoAvailability: { light: true, dark: true } })
  })
})
