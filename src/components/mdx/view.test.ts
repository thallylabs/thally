/** Regression contracts for the page-wide View selector. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const viewSlots = vi.hoisted(() => ({
  activeView: 'Node.js' as string | undefined,
  views: [
    { title: 'Node.js', icon: 'code-simple' },
    { title: 'Python', icon: 'code-simple' },
  ],
  registerView: () => () => undefined,
  setActiveView: () => undefined,
}))

vi.mock('@/components/mdx/page-slots', () => ({
  usePageSlots: () => viewSlots,
}))

import { View } from '@/components/mdx/view'

describe('View', () => {
  beforeEach(() => {
    viewSlots.activeView = 'Node.js'
  })

  it('keeps every option available when a non-first View is active', () => {
    viewSlots.activeView = 'Python'

    const nodeMarkup = renderToStaticMarkup(
      createElement(View, { title: 'Node.js' }, 'npm install'),
    )
    const pythonMarkup = renderToStaticMarkup(
      createElement(View, { title: 'Python' }, 'pip install'),
    )

    expect(nodeMarkup).not.toContain('aria-label="Content view"')
    expect(pythonMarkup).toContain('aria-label="Content view"')
    expect(pythonMarkup).toContain('Node.js')
    expect(pythonMarkup).toContain('Python')
  })
})
