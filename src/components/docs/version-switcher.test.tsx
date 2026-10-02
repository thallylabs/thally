import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VersionSwitcher } from './version-switcher'

describe('VersionSwitcher', () => {
  it('lists only the visible version when the other version is hidden', () => {
    const html = renderToStaticMarkup(
      <VersionSwitcher
        versions={[
          { label: 'v2', prefix: '', href: '/', default: true },
          { label: 'v1', prefix: 'v1', href: '/v1/introduction', hidden: true },
        ]}
        activeLabel="v2"
      />,
    )
    expect(html).toContain('v2')
    expect(html).not.toContain('v1')
  })

  it('is not shown for a site with a single version', () => {
    const html = renderToStaticMarkup(
      <VersionSwitcher versions={[{ label: 'v2', prefix: '', href: '/', default: true }]} activeLabel="v2" />,
    )
    expect(html).toBe('')
  })
})
