/** Merge invariants for importing into an existing localized Thally site. */

import { describe, expect, it } from 'vitest'

import { mergeMigrationConfig } from '../index.js'

describe('migration config merge', () => {
  it('unions existing and imported locales without duplicating page ids', () => {
    const merged = mergeMigrationConfig(
      {
        tabs: [{ tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] }],
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }],
        },
      },
      {
        tabs: [{ tab: 'Documentation', groups: [{ group: 'Start', pages: ['introduction', 'guides/install'] }] }],
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }],
        },
      },
    )

    expect(merged.i18n?.locales.map((locale) => locale.code)).toEqual(['en', 'es', 'fr'])
    expect(merged.tabs).toEqual([
      { tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] },
      { tab: 'Documentation', groups: [{ group: 'Start', pages: ['guides/install'] }] },
    ])
  })
})
