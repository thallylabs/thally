/** Managed search coverage over an asset index and asset-backed page bodies. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTENT_MANIFEST_PATH,
  resetContentSourceForTests,
  setContentAssetFetcher,
} from '@/lib/content-source'
import {
  CONTENT_INDEX_ASSET_PATH,
  resetContentIndexForTests,
} from '@/lib/content-index'
import { loadNavContext, loadSidebarCollections } from '@/data/docs'
import { resetEmbeddingIndex } from '@/lib/embeddings/index-store'
import { resetSearchEngine, searchDocs } from '@/lib/search/engine'

const originalContentSource = process.env.THALLY_CONTENT_SOURCE
const originalContentIndex = process.env.THALLY_CONTENT_INDEX

const pages = {
  'src/content/introduction.mdx': [
    '---',
    'title: Asset-backed introduction',
    'navTitle: Release overview',
    'description: Navigation metadata loaded from the immutable asset index.',
    '---',
    '',
    '# Asset-backed introduction',
    '',
  ].join('\n'),
  'src/content/enterprise/quantum-widgets.mdx': [
    '---',
    'title: Quantum widgets',
    'description: Configure quantum widgets at enterprise scale.',
    '---',
    '',
    '# Quantum widgets',
    '',
    'The entanglement controller coordinates every quantum widget deployment.',
    '',
  ].join('\n'),
  'src/content/enterprise/audit-logs.mdx': [
    '---',
    'title: Audit logs',
    '---',
    '',
    '# Audit logs',
    '',
    'Export governance events for compliance review.',
    '',
  ].join('\n'),
}

beforeEach(() => {
  process.env.THALLY_CONTENT_SOURCE = 'assets'
  delete process.env.THALLY_CONTENT_INDEX
  resetContentIndexForTests()
  resetContentSourceForTests()
  resetEmbeddingIndex()
  resetSearchEngine()
  setContentAssetFetcher(async (assetPath) => {
    if (assetPath === CONTENT_MANIFEST_PATH) {
      return Response.json({
        version: 1,
        files: Object.fromEntries(
          Object.keys(pages).map((filePath) => [filePath, { modifiedAtMs: 1 }]),
        ),
      })
    }
    if (assetPath === CONTENT_INDEX_ASSET_PATH) {
      return Response.json({
        version: 1,
        pages: {
          'src/content/introduction.mdx': {
            data: {
              title: 'Asset-backed introduction',
              navTitle: 'Release overview',
              description: 'Navigation metadata loaded from the immutable asset index.',
            },
            modifiedAtMs: 1,
          },
          'src/content/enterprise/quantum-widgets.mdx': {
            data: {
              title: 'Quantum widgets',
              description: 'Configure quantum widgets at enterprise scale.',
            },
            modifiedAtMs: 1,
          },
          'src/content/enterprise/audit-logs.mdx': {
            data: { title: 'Audit logs' },
            modifiedAtMs: 1,
          },
        },
      })
    }
    const projectPath = decodeURIComponent(assetPath.replace('/_thally/content/', ''))
    const content = pages[projectPath as keyof typeof pages]
    return content === undefined
      ? new Response('not found', { status: 404 })
      : new Response(content)
  })
})

afterEach(() => {
  if (originalContentSource === undefined) delete process.env.THALLY_CONTENT_SOURCE
  else process.env.THALLY_CONTENT_SOURCE = originalContentSource
  if (originalContentIndex === undefined) delete process.env.THALLY_CONTENT_INDEX
  else process.env.THALLY_CONTENT_INDEX = originalContentIndex
  resetContentIndexForTests()
  resetContentSourceForTests()
  resetEmbeddingIndex()
  resetSearchEngine()
  setContentAssetFetcher(null)
})

describe('asset-backed search', () => {
  it('hydrates navigation labels from an asset-only content index', async () => {
    const collections = await loadSidebarCollections()
    const introduction = collections
      .flatMap((collection) => collection.sections)
      .flatMap((section) => section.items)
      .find((item) => item.href === '/')
    const navigation = await loadNavContext('introduction')

    expect(introduction).toMatchObject({
      title: 'Release overview',
      description: 'Navigation metadata loaded from the immutable asset index.',
    })
    expect(navigation.breadcrumb.at(-1)?.label).toBe('Release overview')
  })

  it('enumerates a large-index release and searches remote page bodies', async () => {
    const hits = await searchDocs('entanglement controller', {
      mode: 'fulltext',
      limit: 5,
    })

    expect(hits[0]).toMatchObject({
      pageId: 'enterprise/quantum-widgets',
      title: 'Quantum widgets',
      href: '/enterprise/quantum-widgets',
    })
    expect(hits[0]?.snippet).toContain('entanglement controller')
  })
})
