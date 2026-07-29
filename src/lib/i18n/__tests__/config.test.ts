/** Locale normalization and crawler-path invariants. */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_I18N_CONFIG,
  localeDirection,
  localizedPath,
  normalizeI18nConfig,
  resolveI18nSelection,
  validateI18nSelection,
} from '../config'
import { buildLocaleAlternates } from '../metadata'

describe('normalizeI18nConfig', () => {
  it('canonicalizes, deduplicates, and preserves the selected default', () => {
    expect(
      normalizeI18nConfig({
        defaultLocale: 'pt-br',
        locales: [
          { code: 'en', label: 'English' },
          { code: 'PT-br', label: 'Português (Brasil)' },
          { code: 'pt-BR', label: 'Duplicate' },
        ],
      }),
    ).toEqual({
      defaultLocale: 'pt-BR',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'pt-BR', label: 'Português (Brasil)' },
      ],
    })
  })

  it('falls back safely when live settings are malformed', () => {
    expect(normalizeI18nConfig({ defaultLocale: 'xx', locales: [] })).toEqual(
      DEFAULT_I18N_CONFIG,
    )
  })

  it('uses an available locale when the requested default is absent', () => {
    expect(
      normalizeI18nConfig({
        defaultLocale: 'de',
        locales: [{ code: 'fr', label: 'Français' }],
      }),
    ).toEqual({
      defaultLocale: 'fr',
      locales: [{ code: 'fr', label: 'Français' }],
    })
  })
})

describe('resolveI18nSelection', () => {
  it('keeps the repository source language as the crawler-facing default', () => {
    expect(
      resolveI18nSelection(
        {
          defaultLocale: 'fr',
          locales: [{ code: 'fr', label: 'Français' }],
        },
        DEFAULT_I18N_CONFIG,
      ),
    ).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'fr', label: 'Français' },
      ],
    })
  })

  it('strictly validates persisted selections', () => {
    expect(
      validateI18nSelection(
        {
          defaultLocale: 'fr',
          locales: [
            { code: 'fr', label: '<script>not trusted</script>' },
            { code: 'es', label: 'Español' },
          ],
        },
        DEFAULT_I18N_CONFIG,
      ),
    ).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'fr', label: 'Français' },
        { code: 'es', label: 'Español' },
      ],
    })

    expect(
      validateI18nSelection(
        {
          defaultLocale: 'en',
          locales: [{ code: 'not-a-locale', label: 'Nope' }],
        },
        DEFAULT_I18N_CONFIG,
      ),
    ).toBeNull()
    expect(
      validateI18nSelection(
        {
          defaultLocale: 'en',
          locales: Array.from({ length: 21 }, () => ({
            code: 'es',
            label: 'Too many',
          })),
        },
        DEFAULT_I18N_CONFIG,
      ),
    ).toBeNull()
  })
})

describe('locale URL and direction helpers', () => {
  it('keeps the selected default unprefixed and prefixes other locales', () => {
    expect(localizedPath('/guides/setup', 'fr', 'fr')).toBe('/guides/setup')
    expect(localizedPath('/guides/setup', 'en', 'fr')).toBe('/en/guides/setup')
    expect(localizedPath('/', 'en', 'fr')).toBe('/en')
  })

  it('marks right-to-left language families', () => {
    expect(localeDirection('ar-AE')).toBe('rtl')
    expect(localeDirection('en')).toBe('ltr')
  })

  it('builds locale and x-default crawler targets from one config', () => {
    expect(
      buildLocaleAlternates(
        'https://docs.example.com',
        '/guides/setup',
        DEFAULT_I18N_CONFIG,
      ),
    ).toEqual({
      en: 'https://docs.example.com/guides/setup',
      es: 'https://docs.example.com/es/guides/setup',
      'x-default': 'https://docs.example.com/guides/setup',
    })
  })
})
