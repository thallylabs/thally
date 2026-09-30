/** Checks that portable MDX wrappers preserve useful navigation and URL safety. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ApiTable, IframePreview } from './portable-widgets'

describe('portable MDX widgets', () => {
  it('keeps Docusaurus API table row anchors', () => {
    const html = renderToStaticMarkup(
      <ApiTable name="navbar">
        <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td><code>logo</code></td><td>Brand mark</td></tr></tbody></table>
      </ApiTable>,
    )
    expect(html).toContain('id="navbar-logo"')
    expect(html).not.toContain('id="navbar-Name"')
    expect(html).toContain('Brand mark')
  })

  it('does not embed active non-web URL schemes', () => {
    expect(renderToStaticMarkup(<IframePreview url="javascript:alert(1)" />)).toBe('')
    expect(renderToStaticMarkup(<IframePreview url="data:text/html,hello" />)).toBe('')
    expect(renderToStaticMarkup(<IframePreview url="https://example.com" />)).toContain('src="https://example.com"')
  })
})
