/** Merge invariants for importing into an existing localized Thally site. */

import { describe, expect, it } from 'vitest'

import { mergeMigrationConfig } from '../index.js'

describe('migration config merge', () => {
  it('unions existing and imported locales without duplicating page ids', () => {
    const merged = mergeMigrationConfig(
      {
        tabs: [{ tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] }],
        navigation: { display: 'tabs' },
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }],
        },
      },
      {
        tabs: [{ tab: 'Documentation', groups: [{ group: 'Start', pages: ['introduction', 'guides/install'] }] }],
        navigation: { display: 'dropdown' },
        i18n: {
          defaultLocale: 'en',
          locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'French' }],
        },
      },
    )

    expect(merged.i18n?.locales.map((locale) => locale.code)).toEqual(['en', 'es', 'fr'])
    expect(merged.navigation).toEqual({ display: 'dropdown' })
    expect(merged.tabs).toEqual([
      { tab: 'Existing', groups: [{ group: 'Start', pages: ['introduction'] }] },
      { tab: 'Documentation', groups: [{ group: 'Start', pages: ['guides/install'] }] },
    ])
  })

  it('deduplicates and merges root navigation nodes without adding a wrapper group', () => {
    const merged = mergeMigrationConfig(
      {
        tabs: [{ tab: 'Documentation', pages: ['introduction'] }],
      },
      {
        tabs: [{
          tab: 'Documentation',
          pages: [
            'introduction',
            { group: 'Guides', pages: ['guides/install'] },
          ],
          groups: [{ group: 'Reference', pages: ['reference/api'] }],
        }],
      },
    )

    expect(merged.tabs).toEqual([{
      tab: 'Documentation',
      pages: [
        'introduction',
        { group: 'Guides', pages: ['guides/install'] },
        { group: 'Reference', pages: ['reference/api'] },
      ],
    }])
  })
})
