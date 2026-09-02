/** Regression coverage for release-bound docs.json configuration. */

import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import repositoryDocsConfig from '../../../docs.json'
import { getDocsJsonConfig, resetDocsJsonConfigForTests } from '@/lib/docs-json-config'
import {
  getBannerConfig,
  getBreadcrumbs,
  getContentIconTone,
  getNavCategory,
  getNavContext,
  getNavigablePageIds,
  getNavigationPresentation,
  getSidebarCollections,
  getStructuralTheme,
} from '@/data/docs'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetDocsJsonConfigForTests()
})

describe('release-bound docs.json', () => {
  it('uses a valid managed binding for navigation and appearance', () => {
    vi.stubEnv(
      'THALLY_DOCS_CONFIG',
      JSON.stringify({
        tabs: [{ tab: 'Runtime navigation', groups: [] }],
        appearance: { contentIcons: 'accent' },
        theme: 'sharp',
      }),
    )

    expect(getSidebarCollections()[0]?.label).toBe('Runtime navigation')
    expect(getContentIconTone()).toBe('accent')
    expect(getStructuralTheme()).toBe('sharp')
  })

  it('preserves recursive groups without duplicate visual sections', () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({
      navigation: { display: 'dropdown' },
      tabs: [{
        tab: 'Documentation',
        description: 'Resources for developers',
        icon: 'book-open',
        groups: [{
          group: 'Fundamentals',
          pages: [
            'triggering',
            { group: 'Tasks', pages: ['tasks/overview', 'tasks/scheduled'] },
            'runs',
          ],
        }],
      }],
    }))

    const [collection] = getSidebarCollections()
    expect(getNavigationPresentation()).toEqual({ display: 'dropdown' })
    expect(collection).toMatchObject({
      label: 'Documentation',
      description: 'Resources for developers',
      icon: 'book-open',
    })
    expect(collection.sections.map((section) => section.title)).toEqual(['Fundamentals'])
    expect(collection.sections[0]?.nodes).toMatchObject([
      { type: 'page', item: { id: 'triggering', groupPath: ['Fundamentals'] } },
      {
        type: 'group',
        group: {
          title: 'Tasks',
          nodes: [
            { type: 'page', item: { id: 'tasks-overview', groupPath: ['Fundamentals', 'Tasks'] } },
            { type: 'page', item: { id: 'tasks-scheduled', groupPath: ['Fundamentals', 'Tasks'] } },
          ],
        },
      },
      { type: 'page', item: { id: 'runs', groupPath: ['Fundamentals'] } },
    ])
    expect(collection.sections[0]?.items.map((item) => item.id)).toEqual([
      'triggering',
      'tasks-overview',
      'tasks-scheduled',
      'runs',
    ])
  })

  it('renders root page and group nodes without a synthetic section', () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({
      tabs: [{
        tab: 'Documentation',
        pages: [
          'introduction',
          { group: 'Guides', pages: ['guides/install'] },
          'faq',
        ],
      }],
    }))

    const [section] = getSidebarCollections()[0]?.sections ?? []
    expect(section?.title).toBe('Documentation')
    expect(section?.nodes).toMatchObject([
      { type: 'page', item: { id: 'introduction' } },
      { type: 'group', group: { title: 'Guides' } },
      { type: 'page', item: { id: 'faq' } },
    ])
    expect(section?.items.map((item) => item.id)).toEqual([
      'introduction',
      'guides-install',
      'faq',
    ])
    expect([...getNavigablePageIds()]).toEqual([
      'introduction',
      'guides/install',
      'faq',
    ])
    expect(getNavCategory('/')).toBeNull()
    expect(getNavContext('introduction').group).toBe('')
    expect(getBreadcrumbs('/').map((crumb) => crumb.label)).toEqual([
      'Documentation',
      expect.any(String),
    ])
  })

  it('invalidates config-derived caches when the release binding changes', () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({ tabs: [{ tab: 'First release', groups: [] }] }))
    expect(getSidebarCollections()[0]?.label).toBe('First release')

    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({ tabs: [{ tab: 'Second release', groups: [] }] }))
    expect(getSidebarCollections()[0]?.label).toBe('Second release')
  })

  it('falls back to the compiled file when the binding is malformed', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubEnv('THALLY_DOCS_CONFIG', '{"tabs":null}')

    expect(getDocsJsonConfig()).toEqual(repositoryDocsConfig)
    expect(warning).toHaveBeenCalledOnce()
  })

  it('accepts the legacy DOX binding when the Thally name is absent', () => {
    vi.stubEnv('DOX_DOCS_CONFIG', JSON.stringify({ tabs: [{ tab: 'Legacy release', groups: [] }] }))

    expect(getSidebarCollections()[0]?.label).toBe('Legacy release')
  })

  it('preserves localized banner copy for request-path selection', () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({
      tabs: [],
      i18n: { defaultLocale: 'es', locales: [{ code: 'es', label: 'Español' }] },
      banner: { content: { en: 'Hello', es: 'Hola' }, variant: 'warning' },
    }))
    expect(getBannerConfig()).toMatchObject({ content: { en: 'Hello', es: 'Hola' }, type: 'warning' })
  })

  it('normalizes malformed nested banner settings without throwing', () => {
    vi.stubEnv('THALLY_DOCS_CONFIG', JSON.stringify({
      tabs: [],
      banner: { content: { en: 'Hello', bad: 42 }, type: 'javascript', dismissible: 'yes', color: { light: 12 } },
    }))
    expect(getBannerConfig()).toEqual({
      content: { en: 'Hello' },
      dismissible: undefined,
      id: undefined,
      revision: undefined,
      type: undefined,
      color: { light: undefined, dark: undefined },
    })
  })

  it('resolves presentation settings inside the request-time root layout', async () => {
    const source = await readFile('src/app/layout.tsx', 'utf8')
    const rootLayoutStart = source.indexOf('export default async function RootLayout')

    expect(rootLayoutStart).toBeGreaterThan(0)
    for (const call of [
      'resolveFontPresentation()',
      'getStructuralTheme()',
      'getContentIconTone()',
      'getBannerConfig()',
      'getCustomScriptsConfig()',
    ]) {
      expect(source.indexOf(call, rootLayoutStart)).toBeGreaterThan(rootLayoutStart)
    }
  })
})
