/** Translated navigation labels should follow the active content locale. */

import { describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({
  tabs: [{ tab: 'Documentation', groups: [{ group: 'Get started', pages: ['secret', 'quickstart'] }] }],
  i18n: {
    defaultLocale: 'en',
    locales: [{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }],
    navigation: {
      es: [{ tab: 'Documentación', groups: [{ group: 'Comenzar', pages: ['secret', 'quickstart'] }] }],
    },
  },
}))

vi.mock('@/lib/docs-json-config', () => ({
  getDocsJsonConfig: () => config,
  getDocsJsonConfigRevision: () => 1,
}))
vi.mock('@/lib/runtime-sources', () => ({
  listRuntimeSources: () => ['src/content/quickstart.mdx', 'src/content/es/quickstart.mdx', 'src/content/secret.mdx'],
  readRuntimeSource: (path: string) => path.endsWith('secret.mdx')
    ? '---\ntitle: Secret\nhidden: true\n---\nDirect links only'
    : path.includes('/es/')
    ? '---\ntitle: Inicio rápido\n---\nContenido'
    : '---\ntitle: Quickstart\n---\nContent',
  runtimeSourceExists: () => true,
}))

import { getBreadcrumbs, getNavCategory, getNavContext, getSidebarCollections } from './docs'

describe('locale navigation', () => {
  it('uses source-authored labels with translated page titles', () => {
    expect(getSidebarCollections('es')[0]).toMatchObject({ label: 'Documentación' })
    expect(getSidebarCollections('es')[0].sections[0]).toMatchObject({ title: 'Comenzar' })
    expect(getSidebarCollections('es')[0].sections[0].items.map((item) => item.title)).toEqual(['Inicio rápido'])
    expect(getBreadcrumbs('/es/quickstart').map((crumb) => crumb.label)).toEqual([
      'Documentación', 'Comenzar', 'Inicio rápido',
    ])
    expect(getNavCategory('/es/quickstart')).toBe('Comenzar')
    expect(getNavContext('quickstart', 'es')).toMatchObject({
      tab: 'Documentación', group: 'Comenzar',
      breadcrumb: [{ label: 'Documentación' }, { label: 'Comenzar' }, { label: 'Inicio rápido' }],
    })
    expect(getSidebarCollections()[0].label).toBe('Documentation')
  })
})
