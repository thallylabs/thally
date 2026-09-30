/** Regression tests for Mintlify-parity aliases in the MDX components map. */

import type { ComponentType, ReactNode } from 'react'
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

describe('Column', () => {
  it('renders its children as a single grid cell inside <Columns>', () => {
    const { Column } = useMDXComponents({})
    const Component = Column as ComponentType<{ children?: ReactNode }>
    const html = renderToStaticMarkup(<Component><p>cell content</p></Component>)
    expect(html).toContain('cell content')
  })
})

describe('FileTree', () => {
  it('aliases to Tree', () => {
    const { FileTree } = useMDXComponents({})
    const Component = FileTree as ComponentType<{ children?: ReactNode }>
    const html = renderToStaticMarkup(<Component><p>src/</p></Component>)
    expect(html).toContain('src/')
  })
})

describe('GitHub', () => {
  it('keeps the Repo static so the compound tag <GitHub.Repo> resolves', () => {
    const { GitHub } = useMDXComponents({}) as { GitHub: ComponentType<{ repo: string }> & { Repo: ComponentType<{ repo: string }> } }
    const html = renderToStaticMarkup(<GitHub.Repo repo="thallylabs/thally" />)
    expect(html).toContain('href="https://github.com/thallylabs/thally"')
  })
})

describe('MDX', () => {
  it('renders children through as-is', () => {
    const { MDX } = useMDXComponents({})
    const Component = MDX as ComponentType<{ children?: ReactNode }>
    const html = renderToStaticMarkup(<Component><p>hello</p></Component>)
    expect(html).toBe('<p>hello</p>')
  })
})
