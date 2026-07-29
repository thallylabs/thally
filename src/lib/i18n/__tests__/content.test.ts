/** Translation-availability checks for crawler-facing locale projections. */

import { describe, expect, it } from 'vitest'
import { getContentI18nConfig } from '../content'
import { DEFAULT_I18N_CONFIG } from '../config'

describe('getContentI18nConfig', () => {
  it('includes authored translations and omits source-language fallbacks', async () => {
    await expect(
      getContentI18nConfig(['introduction'], DEFAULT_I18N_CONFIG),
    ).resolves.toEqual(DEFAULT_I18N_CONFIG)

    await expect(
      getContentI18nConfig(
        ['guides', 'multi-language'],
        DEFAULT_I18N_CONFIG,
      ),
    ).resolves.toEqual({
      defaultLocale: 'en',
      locales: [{ code: 'en', label: 'English' }],
    })
  })
})
