/**
 * The category eyebrow shown above every doc page title is derived from the
 * docs.json navigation model — never duplicated into page frontmatter. These
 * tests pin that derivation (nearest group wins, pages outside groups get
 * none) and the locale invariants it relies on: navigation labels are
 * single-sourced, so switching locale can change content but never the
 * navigation structure or appearance tokens around it.
 */

import { describe, expect, it } from 'vitest'
import { getNavCategory, getSidebarCollections } from '@/data/docs'
import docsConfig from '../../../docs.json'

describe('getNavCategory', () => {
  it('returns the containing group for a grouped page', () => {
    // Config-driven so the same framework-synced test passes in the runtime
    // and in scaffolded sites: pick the first grouped page from the model.
    const collections = getSidebarCollections()
    const section = collections.flatMap((c) => c.sections).find((s) => s.items.length > 0)
    expect(section).toBeDefined()
    const leaf = section!.title.split(' • ').at(-1)
    expect(getNavCategory(section!.items[0].href)).toBe(leaf)
  })

  it('resolves the first group of the first tab for the home page', () => {
    const firstGroup = (docsConfig as { tabs: Array<{ groups?: Array<{ group: string }> }> })
      .tabs[0]?.groups?.[0]?.group
    expect(getNavCategory('/')).toBe(firstGroup)
  })

  it('returns null for pages outside any navigation group', () => {
    expect(getNavCategory('/definitely-not-a-nav-page')).toBeNull()
  })

  it('matches the leaf group for every navigable page', () => {
    // Every grouped page must produce a non-empty category — the eyebrow can
    // never render blank text.
    for (const collection of getSidebarCollections()) {
      for (const section of collection.sections) {
        for (const item of section.items) {
          const category = getNavCategory(item.href)
          expect(category, `category for ${item.href}`).toBeTruthy()
          expect(section.title.endsWith(category as string)).toBe(true)
        }
      }
    }
  })
})

describe('locale switching keeps navigation structure and labels identical', () => {
  it('resolves the same tabs, groups and item order for en and es', () => {
    const en = getSidebarCollections()
    const es = getSidebarCollections('es')

    expect(es.map((c) => c.label)).toEqual(en.map((c) => c.label))
    for (let i = 0; i < en.length; i++) {
      expect(es[i].sections.map((s) => s.title)).toEqual(en[i].sections.map((s) => s.title))
      for (let j = 0; j < en[i].sections.length; j++) {
        expect(es[i].sections[j].items.map((it) => it.id)).toEqual(
          en[i].sections[j].items.map((it) => it.id),
        )
      }
    }
  })

  it('changes only the locale prefix on hrefs — never structure', () => {
    const en = getSidebarCollections()
    const es = getSidebarCollections('es')

    for (let i = 0; i < en.length; i++) {
      for (let j = 0; j < en[i].sections.length; j++) {
        for (let k = 0; k < en[i].sections[j].items.length; k++) {
          const enHref = en[i].sections[j].items[k].href
          const esHref = es[i].sections[j].items[k].href
          if (enHref.startsWith('http') || esHref.startsWith('http')) continue
          expect(esHref === enHref || esHref === `/es${enHref === '/' ? '' : enHref}`).toBe(true)
        }
      }
    }
  })
})
