/** Document identity must remain independent of author-controlled display titles. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getDocFromParams } from './get-doc'
import { EditOnGithub } from '@/components/docs/edit-on-github'
import { ReportAnIssue } from '@/components/docs/report-an-issue'

vi.mock('@/data/docs', () => ({
  deriveTitleFromSlug: (slug: string) => slug,
  getI18nConfig: () => ({ defaultLocale: 'en' }),
}))
vi.mock('next-mdx-remote/rsc', () => ({ compileMDX: vi.fn() }))
vi.mock('@/lib/mdx-interpret', () => ({ interpretMDX: vi.fn() }))
vi.mock('@/mdx/remark', () => ({ remarkPlugins: [] }))
vi.mock('@/mdx/rehype', () => ({ rehypePlugins: [] }))
vi.mock('@/components/mdx/mdx-components', () => ({ useMDXComponents: () => ({}) }))
vi.mock('@/mdx/snippet-registry', () => ({ resolveSnippetComponent: vi.fn() }))
vi.mock('@/lib/runtime-sources', () => ({
  runtimeSourceExists: () => true,
  readRuntimeSource: () => '# Content',
}))
vi.mock('@/lib/content-source', () => ({
  getContentSource: () => ({
    kind: 'filesystem',
    exists: async (path: string) => ['src/content/introduction.mdx', 'src/content/events.mdx'].includes(path),
    read: async () => ({ content: '# Content' }),
  }),
}))
vi.mock('@/generated/runtime-docs', () => ({
  runtimeDocs: {
    'src/content/introduction.mdx': {
      component: () => null,
      frontmatter: { title: 'Product documentation' },
    },
    'src/content/events.mdx': {
      component: () => null,
      frontmatter: { title: 'Event delivery' },
    },
  },
}))

describe('document source identity', () => {
  it.each([{ slug: undefined }, { slug: [] }])('uses introduction for the root route $slug', async ({ slug }) => {
    const doc = await getDocFromParams(slug)
    expect(doc).toMatchObject({ id: 'introduction', title: 'Product documentation', href: '/', slug: [] })
    const html = renderToStaticMarkup(createElement(EditOnGithub, {
      pageId: doc!.id,
      repoUrl: 'https://github.com/example/docs',
    }))
    expect(html).toContain('href="https://github.com/example/docs/edit/main/src/content/introduction.mdx"')

    const issueHtml = renderToStaticMarkup(createElement(ReportAnIssue, {
      pagePath: doc!.href,
      repoUrl: 'https://github.com/example/docs',
    }))
    expect(issueHtml).toContain('href="https://github.com/example/docs/issues/new?title=Docs%20feedback%3A%20%2F"')
  })

  it('keeps non-root identity separate from the display title', async () => {
    const doc = await getDocFromParams(['events'])
    expect(doc).toMatchObject({ id: 'events', title: 'Event delivery', href: '/events', slug: ['events'] })
  })
})
