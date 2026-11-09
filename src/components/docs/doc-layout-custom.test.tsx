/** `mode: custom` pages drop the shell sidebar: the page marks itself and the stylesheet hides the aside. */

import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DocEntry } from '@/data/docs'

vi.mock('next/navigation', () => ({ usePathname: () => '/welcome' }))
vi.mock('@/data/docs', () => ({
  getBreadcrumbs: () => [],
  getBreadcrumbsEnabled: () => false,
  getEyebrowMode: () => 'group',
  getNavCategory: () => '',
  getNavGroupPath: () => [],
  getPrevNextLinks: () => ({ prev: null, next: null }),
  getFeedbackConfig: () => ({}),
}))
vi.mock('@/components/docs/doc-breadcrumbs', () => ({ DocBreadcrumbs: () => null }))
vi.mock('@/components/docs/doc-pagination', () => ({ DocPagination: () => null }))
vi.mock('@/components/docs/edit-on-github', () => ({ EditOnGithub: () => null }))
vi.mock('@/components/docs/feedback', () => ({ Feedback: () => null }))
vi.mock('@/components/docs/report-an-issue', () => ({ ReportAnIssue: () => null }))
vi.mock('@/components/docs/table-of-contents', () => ({ TableOfContents: () => null }))
vi.mock('@/lib/cloud-link/client', () => ({ getManagedSiteConfigSnapshot: () => null }))
vi.mock('@/lib/cloud-link/content-controls', () => ({
  getBuildContentControls: () => ({ showBreadcrumbs: false, showCopyPage: false, showTableOfContents: false }),
}))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ repoUrl: null }) }))

import { DocLayout } from '@/components/docs/doc-layout'

describe('mode: custom', () => {
  it('marks the page so the shell can hide its sidebar', () => {
    const doc = { id: 'welcome', href: '/welcome', title: 'Welcome', mode: 'custom' } as DocEntry
    expect(renderToStaticMarkup(<DocLayout doc={doc}>body</DocLayout>)).toContain('data-doc-mode="custom"')
    expect(renderToStaticMarkup(<DocLayout doc={{ ...doc, mode: undefined }}>body</DocLayout>)).not.toContain('data-doc-mode')
  })

  it('hides the docs sidebar for a marked page', () => {
    const css = readFileSync(new URL('../../styles/docs-handoff.css', import.meta.url), 'utf8')
    expect(css).toMatch(/:has\(\[data-doc-mode='custom'\]\)\s+\.thally-docs-sidebar\s*\{\s*display:\s*none/)
  })
})
