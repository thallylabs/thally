/** Tabs render every panel with ARIA tab roles; only the active one is visible. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Tab, Tabs } from './content-tabs'

describe('Tabs', () => {
  const html = renderToStaticMarkup(
    <Tabs>
      <Tab title="One">first-body</Tab>
      <Tab title="Two">second-body</Tab>
    </Tabs>,
  )

  it('keeps inactive panels in the server HTML, hidden', () => {
    expect(html).toContain('first-body')
    expect(html).toContain('second-body')
    expect(html.match(/<div[^>]*hidden/g)).toHaveLength(1)
  })
})
