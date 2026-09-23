/** Translation-availability checks for crawler-facing locale projections. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getIndexableDocTranslation: vi.fn(),
}))

vi.mock('@/data/get-doc', () => ({
  getIndexableDocTranslation: mocks.getIndexableDocTranslation,
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
    mocks.getIndexableDocTranslation.mockReset()
    mocks.getIndexableDocTranslation.mockImplementation(
      async (slug: Array<string> | undefined, locale: string) =>
        slug?.join('/') === 'introduction' && locale === 'es'
          ? { modifiedAtMs: 1 }
          : null,
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

    expect(mocks.getIndexableDocTranslation.mock.calls).toEqual([
      [['introduction'], 'es'],
      [['introduction'], 'fr'],
      [['guides', 'multi-language'], 'es'],
      [['guides', 'multi-language'], 'fr'],
    ])
  })
})
