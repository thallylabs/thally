/** Sidebar page selection remains unique when a landing page has child routes. */

import { createElement, type AnchorHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NavigationNode } from '@/data/docs'

vi.mock('./intent-prefetch-link', () => ({
  IntentPrefetchLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement('a', props),
}))

import { NavigationTree } from './navigation-tree'

describe('sidebar current page', () => {
  it('selects the child route without also selecting its parent landing page', () => {
    const nodes = [
      { type: 'page', item: { id: 'pnpr', title: 'Introduction', href: '/pnpr' } },
      { type: 'page', item: { id: 'config', title: 'Configuration', href: '/pnpr/configuration' } },
    ] as Array<NavigationNode>
    const html = renderToStaticMarkup(<NavigationTree nodes={nodes} pathname="/pnpr/configuration" />)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('href="/pnpr/configuration" aria-current="page"')
    expect(html).not.toContain('href="/pnpr" aria-current="page"')
  })
})
