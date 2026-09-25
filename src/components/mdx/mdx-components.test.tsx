/** Regression test for the Mintlify-parity `Banner` alias. */

import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { useMDXComponents } from './mdx-components'

describe('Banner', () => {
  it('aliases to the site banner treatment', () => {
    const { Banner } = useMDXComponents({})
    const Component = Banner as ComponentType<{ content: string; type?: 'info' | 'warning' | 'critical' }>
    const html = renderToStaticMarkup(<Component content="Scheduled maintenance tonight." type="warning" />)
    expect(html).toContain('Scheduled maintenance tonight.')
    expect(html).toContain('data-variant="warning"')
  })
})
