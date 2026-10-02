import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VersionSwitcher } from './version-switcher'

describe('VersionSwitcher', () => {
  it('is not shown when the only other version is hidden', () => {
    const html = renderToStaticMarkup(
      <VersionSwitcher
        versions={[
          { label: 'v2', prefix: '', href: '/', default: true },
          { label: 'v1', prefix: 'v1', href: '/v1/introduction', hidden: true },
        ]}
        activeLabel="v2"
      />,
    )
    expect(html).toBe('')
  })
})
