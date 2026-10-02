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

  it('exposes tablist, tab and tabpanel roles with aria-selected', () => {
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-selected="false"')
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2)
  })

  it('keeps inactive panels in the server HTML, hidden', () => {
    expect(html).toContain('first-body')
    expect(html).toContain('second-body')
    expect(html.match(/<[^>]*role="tabpanel"[^>]*hidden/g)).toHaveLength(1)
  })
})
