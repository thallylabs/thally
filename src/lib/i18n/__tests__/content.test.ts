/** Translation-availability checks for crawler-facing locale projections. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasDocTranslation: vi.fn(),
}))

vi.mock('@/data/get-doc', () => ({
  hasDocTranslation: mocks.hasDocTranslation,
}))

import { getContentI18nConfig } from '../content'

const selectedLocales = {
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' },
  ],
}

describe('getContentI18nConfig', () => {
  beforeEach(() => {
    mocks.hasDocTranslation.mockReset()
    mocks.hasDocTranslation.mockImplementation(
      async (slug: Array<string> | undefined, locale: string) =>
        slug?.join('/') === 'introduction' && locale === 'es',
    )
  })

  it('includes authored translations and omits source-language fallbacks', async () => {
    await expect(
      getContentI18nConfig(['introduction'], selectedLocales),
    ).resolves.toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'es', label: 'Español' },
      ],
    })

    await expect(
      getContentI18nConfig(['guides', 'multi-language'], selectedLocales),
    ).resolves.toEqual({
      defaultLocale: 'en',
      locales: [{ code: 'en', label: 'English' }],
    })

    expect(mocks.hasDocTranslation.mock.calls).toEqual([
      [['introduction'], 'es'],
      [['introduction'], 'fr'],
      [['guides', 'multi-language'], 'es'],
      [['guides', 'multi-language'], 'fr'],
    ])
  })
})
