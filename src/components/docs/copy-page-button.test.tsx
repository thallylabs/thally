/** The page menu offers the entries docs.json `contextual.options` lists, in that order. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/guide' }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  // Render the menu open: the dropdown is client state that server rendering never reaches.
  useState: (initial: unknown) => [initial === false ? true : initial, vi.fn()],
}))

import { CopyPageButton } from './copy-page-button'

const labels = (html: string) => [...html.matchAll(/(View as Markdown|Open in \w+)/g)].map((match) => match[1])

describe('page menu options', () => {
  it('keeps every entry when docs.json has no contextual options', () => {
    const html = renderToStaticMarkup(<CopyPageButton />)
    expect(html).toContain('Copy page')
    expect(labels(html)).toEqual(['View as Markdown', 'Open in ChatGPT', 'Open in Claude', 'Open in Perplexity'])
  })

  it('shows only the listed entries in the listed order', () => {
    const html = renderToStaticMarkup(<CopyPageButton options={['copy', 'view', 'chatgpt', 'claude']} />)
    expect(labels(html)).toEqual(['View as Markdown', 'Open in ChatGPT', 'Open in Claude'])
    expect(html).not.toContain('Perplexity')
    expect(labels(renderToStaticMarkup(<CopyPageButton options={['claude', 'chatgpt']} />))).toEqual(['Open in Claude', 'Open in ChatGPT'])
  })

  it('drops the copy button when it is not listed', () => {
    expect(renderToStaticMarkup(<CopyPageButton options={['view']} />)).not.toContain('Copy page')
  })
})
