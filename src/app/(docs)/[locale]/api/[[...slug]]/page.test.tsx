/** API-prefixed MDX must reach the localized document renderer. */
import { describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({
  renderDoc: vi.fn<(props: { params: Promise<{ slug: string[] }> }) => Promise<null>>(async () => null),
  metadata: vi.fn<(props: { params: Promise<{ slug: string[] }> }) => Promise<{ title: string }>>(
    async () => ({ title: 'Guide français' }),
  ),
}))

vi.mock('@/app/(docs)/[[...slug]]/page', () => ({
  default: fixtures.renderDoc,
  generateMetadata: fixtures.metadata,
}))
vi.mock('@/data/api-reference', () => ({
  getApiOperationBySlug: vi.fn(async () => null),
  getAllApiOperationNodes: vi.fn(async () => []),
  getApiOperationNodes: vi.fn(async () => []),
}))
vi.mock('@/lib/i18n/request', () => ({
  getEffectiveI18nConfig: async () => ({ defaultLocale: 'en', locales: [{ code: 'en' }, { code: 'fr' }] }),
  getRepositoryI18nConfig: () => ({ defaultLocale: 'en', locales: [{ code: 'en' }] }),
}))
vi.mock('@/lib/site-url', () => ({ getSiteUrl: () => 'https://docs.example.test' }))
vi.mock('@/config/api-reference', () => ({ apiReferenceConfig: { defaultSpecId: 'default' }, getOpenApiSpecUrl: () => null }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'Docs' }) }))

import LocaleApiReferencePage, { generateMetadata } from './page'

describe('localized API MDX routing', () => {
  it('delegates non-OpenAPI slugs and metadata to localized docs', async () => {
    const params = Promise.resolve({ locale: 'fr', slug: ['overview'] })
    await LocaleApiReferencePage({ params })
    await generateMetadata({ params })

    expect(fixtures.renderDoc).toHaveBeenCalledWith({
      params: expect.any(Promise),
    })
    expect(await fixtures.renderDoc.mock.calls[0]![0].params).toEqual({ slug: ['fr', 'api', 'overview'] })
    expect(await fixtures.metadata.mock.calls[0]![0].params).toEqual({ slug: ['fr', 'api', 'overview'] })
  })
})
