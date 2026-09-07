/** Route identity regressions for multilingual repositories with custom landing pages. */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateRepository, projectMintlifyNavigation } from '../index.js'

function repository(config: Record<string, unknown>, pages: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'thally-migrate-routes-'))
  writeFileSync(join(root, 'docs.json'), JSON.stringify({ $schema: 'https://mintlify.com/docs.json', ...config }))
  for (const [path, content] of Object.entries(pages)) {
    const destination = join(root, `${path}.mdx`)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
  }
  return root
}

describe('Mintlify repository route identity', () => {
  it('uses authored navigation for the root while retaining an unlisted custom home', () => {
    const root = repository({
      navigation: { groups: [{ group: 'Overview', pages: ['introduction/introduction'] }] },
    }, {
      home: '---\ntitle: Custom home\nmode: custom\n---\n\nA separate landing page.',
      'introduction/introduction': '# Documentation\n\nThe primary documentation overview.',
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs' })
    expect(bundle.pages.map((page) => page.id)).toEqual(['introduction/introduction', 'home'])
    expect(bundle.docsConfig.tabs[0].groups?.[0].pages).toEqual(['introduction/introduction'])
    expect(bundle.docsConfig.redirects).toEqual(expect.arrayContaining([
      { source: '/', destination: '/introduction/introduction', permanent: false },
      { source: '/introduction', destination: '/introduction/introduction', permanent: false },
    ]))
  })

  it('aligns directory and legacy section translations with default navigation', () => {
    const root = repository({
      navigation: { languages: [
        { language: 'zh-hans', groups: [{ group: '指南', pages: [
          'zh-Hans/introduction/introduction', 'zh-hans-api-reference/getToken',
        ] }] },
        { language: 'en', default: true, groups: [{ group: 'Guide', pages: [
          'introduction/introduction', 'api-reference/getToken',
        ] }] },
      ] },
    }, {
      'introduction/introduction': '# Overview\n\nDefault overview.',
      'api-reference/getToken': '# Get token\n\nDefault API reference.',
      'zh-Hans/introduction/introduction': '# 概览\n\n翻译。',
      'zh-hans-api-reference/getToken': '---\ntitle: 代币\n---\n\n翻译。',
      'zh-hans-api-reference/unlisted': '# Additional endpoint\n\nNo canonical counterpart.',
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs' })
    expect(bundle.docsConfig.i18n).toMatchObject({ defaultLocale: 'en', locales: [{ code: 'zh-Hans' }, { code: 'en' }] })
    expect(bundle.docsConfig.tabs[0].groups?.[0].pages).toEqual(['introduction/introduction', 'api-reference/getToken'])
    expect(bundle.pages.find((page) => page.id === 'zh-Hans/api-reference/getToken')).toMatchObject({
      navigationId: 'api-reference/getToken', locale: 'zh-Hans', title: '代币',
    })
    expect(bundle.pages.some((page) => page.id === 'zh-hans-api-reference/unlisted')).toBe(true)
    expect(bundle.docsConfig.redirects).toEqual(expect.arrayContaining([
      { source: '/zh-hans-api-reference/getToken', destination: '/zh-Hans/api-reference/getToken', permanent: false },
      { source: '/zh-Hans', destination: '/zh-Hans/introduction/introduction', permanent: false },
      { source: '/introduction', destination: '/introduction/introduction', permanent: false },
      { source: '/zh-Hans/introduction', destination: '/zh-Hans/introduction/introduction', permanent: false },
    ]))
    expect(bundle.warnings).toEqual([])
  })

  it('preserves source redirects and default-language directory aliases', () => {
    const root = repository({
      redirects: [{ source: '/', destination: '/home', permanent: true }],
      navigation: { languages: [{ language: 'en', groups: [{ group: 'Guide', pages: ['en/guides/start'] }] }] },
    }, {
      home: '# Welcome\n\nCustom landing page.',
      'en/guides/start': '# Start\n\nStart the integration.',
    })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs' })
    expect(bundle.docsConfig.redirects?.filter((redirect) => redirect.source === '/')).toEqual([
      { source: '/', destination: '/home', permanent: true },
    ])
    expect(bundle.docsConfig.redirects).toContainEqual({ source: '/en/guides/start', destination: '/guides/start', permanent: false })
  })

  it('skips invalid locale directories without discarding valid navigation', () => {
    const projected = projectMintlifyNavigation({ navigation: { languages: [
      { language: '../../escape', pages: ['unsafe'] },
      { language: 'en', pages: ['introduction'] },
    ] } })
    expect(projected.pageReferences).toEqual([{ ref: 'introduction', navigationId: 'introduction', locale: 'en' }])
    expect(projected.warnings).toHaveLength(1)
  })

  it('keeps a shared source file in the primary language and avoids self redirects', () => {
    const root = repository({ navigation: { languages: [
      { language: 'en', pages: ['introduction'] },
      { language: 'fr', pages: ['introduction'] },
    ] } }, { introduction: '# Welcome\n\nA shared overview for both language menus.' })
    const bundle = migrateRepository({ repositoryDir: root, sourceUrl: 'https://github.com/example/docs' })
    expect(bundle.pages.map((page) => page.id)).toEqual(['introduction'])
    expect(bundle.docsConfig.redirects).toBeUndefined()
  })
})
