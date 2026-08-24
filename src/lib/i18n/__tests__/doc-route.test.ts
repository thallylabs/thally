/** Regression coverage for locale parsing inside the unified docs catch-all. */

import { describe, expect, it } from 'vitest'
import type { I18nConfig } from '@/lib/i18n/config'
import { resolveDocRoute } from '@/lib/i18n/doc-route'

const config: I18nConfig = {
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
  ],
}

describe('resolveDocRoute', () => {
  it('keeps an ordinary first segment in the documentation slug', () => {
    expect(resolveDocRoute(['quickstart'], config)).toEqual({
      docSlug: ['quickstart'],
      locale: 'en',
      isLocaleRoute: false,
    })
  })

  it('removes a configured secondary locale from the documentation slug', () => {
    expect(resolveDocRoute(['es', 'quickstart'], config)).toEqual({
      docSlug: ['quickstart'],
      locale: 'es',
      isLocaleRoute: true,
    })
  })

  it('maps a locale-only path to the localized home page', () => {
    expect(resolveDocRoute(['es'], config)).toEqual({
      docSlug: undefined,
      locale: 'es',
      isLocaleRoute: true,
    })
  })

  it('does not accept the default locale as a URL prefix', () => {
    expect(resolveDocRoute(['en', 'quickstart'], config)).toEqual({
      docSlug: ['en', 'quickstart'],
      locale: 'en',
      isLocaleRoute: false,
    })
  })
})
