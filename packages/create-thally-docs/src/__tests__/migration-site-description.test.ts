/** The scaffolded site description of a migration never falls back to a placeholder. */

import { describe, expect, it } from 'vitest'

import { migratedSiteDescription } from '../migrate/index.js'

const page = (id: string, description?: string) => ({ id, title: id, body: '', ...(description ? { description } : {}) })

describe('migratedSiteDescription', () => {
  it('prefers the source site description', () => {
    expect(migratedSiteDescription({ site: { description: 'Site' }, pages: [page('introduction', 'Home')] } as never)).toBe('Site')
  })

  it('uses the home page description when the source has none', () => {
    expect(migratedSiteDescription({ pages: [page('guide/a', 'A'), page('introduction', 'Home')] } as never)).toBe('Home')
  })

  it('is empty rather than a placeholder', () => {
    expect(migratedSiteDescription({ pages: [page('introduction')] } as never)).toBe('')
    expect(migratedSiteDescription({ pages: [] } as never)).toBe('')
  })
})
