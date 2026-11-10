/** An `api:` page without authored samples gets the generated request samples in its code rail. */

// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildManualOperation } from '@/lib/openapi/manual-operation'
import { usePreferredLanguageStore } from '@/lib/preferred-language'

vi.mock('next/navigation', () => ({ usePathname: () => '/api-reference/get-webhook-jwks' }))
vi.mock('@/components/docs/code-actions-provider', () => ({
  useDocsCodeActions: () => ({ hasAssistantEntryPoint: false }),
}))

import { ManualApiEndpoint } from '@/components/api/manual-api-endpoint'
import { PagePanelSlot, PageSlotsProvider } from '@/components/mdx/page-slots'

function operation(mdx: string) {
  const built = buildManualOperation({
    pageId: 'get-webhook-jwks',
    title: 'Get webhook JWKS',
    api: 'GET https://api.example.com/public/v1/discovery/webhooks/jwks',
    mdx,
    config: { servers: [] },
  })
  if (!built) throw new Error('operation expected')
  return built
}

let root: Root
let container: HTMLElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  usePreferredLanguageStore.setState({ preferredLanguages: [] })
  document.body.innerHTML = '<div id="root"></div>'
  container = document.getElementById('root') as HTMLElement
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

async function render(mdx: string) {
  await act(async () => {
    root.render(
      <PageSlotsProvider>
        <ManualApiEndpoint operation={operation(mdx)} />
        <aside><PagePanelSlot fallback={null} /></aside>
      </PageSlotsProvider>,
    )
  })
}

describe('ManualApiEndpoint samples', () => {
  it('shows the generated request samples in the code rail', async () => {
    await render('')
    const rail = container.querySelector('aside [data-mdx-panel]')
    expect(rail).not.toBeNull()
    expect(rail?.textContent).toContain('https://api.example.com/public/v1/discovery/webhooks/jwks')
    expect(rail?.textContent).toContain('curl')
  })

  it('leaves the rail empty when the page authors its own RequestExample', async () => {
    await render('<RequestExample>\n\n```bash\ncurl x\n```\n\n</RequestExample>')
    expect(container.querySelector('[data-mdx-panel]')).toBeNull()
  })
})
