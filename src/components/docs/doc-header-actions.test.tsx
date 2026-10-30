/** Prose headers must receive the same tenant configuration as generated API headers. */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/data/docs', () => ({ getContextualOptions: () => ['copy', 'llms-full', 'mcp', 'cursor', 'vscode'] }))
vi.mock('@/lib/site-config', () => ({ resolveBuildSiteConfig: () => ({ name: 'My Tenant' }) }))
vi.mock('@/components/docs/copy-page-button', () => ({ CopyPageButton: (props: { options: string[]; serverName: string }) => <div data-options={props.options.join(',')} data-server={props.serverName} /> }))
import { DocHeader } from './doc-header'
describe('document header page actions', () => {
  it('passes configured actions and normalized tenant identity', () => {
    const html = renderToStaticMarkup(<DocHeader doc={{ title: 'Guide' } as never} />)
    expect(html).toContain('data-options="copy,llms-full,mcp,cursor,vscode"')
    expect(html).toContain('data-server="my-tenant-docs"')
  })
})
