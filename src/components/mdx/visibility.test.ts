/** HTML projection coverage for audience visibility wrappers. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Agent, Human, Visibility } from '@/components/mdx/visibility'

describe('Visibility', () => {
  it('renders human content and omits agent content from HTML', () => {
    expect(renderToStaticMarkup(createElement(Visibility, { for: 'humans' }, 'Reader'))).toContain('Reader')
    expect(renderToStaticMarkup(createElement(Visibility, { for: 'agents' }, 'Machine'))).toBe('')
    expect(renderToStaticMarkup(createElement(Human, null, 'Reader'))).toContain('Reader')
    expect(renderToStaticMarkup(createElement(Agent, null, 'Machine'))).toBe('')
  })
})
