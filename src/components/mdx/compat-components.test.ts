/** Focused compatibility contracts for page-scoped and legacy MDX components. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PagePanelSlot, PageSlotsProvider } from '@/components/mdx/page-slots'
import { Panel, InlinePanel } from '@/components/mdx/panel'
import { RequestExample, ResponseExample } from '@/components/mdx/examples'
import { Prompt, TerminalInput, TerminalOutput } from '@/components/mdx/prompt'
import { Embed, View } from '@/components/mdx/view'

describe('semantic compatibility components', () => {
  it('keeps canonical Panel content in the authored server output', () => {
    const markup = renderToStaticMarkup(
      createElement(PageSlotsProvider, null,
        createElement('main', null,
          createElement(Panel, null, createElement('p', null, 'Contextual example')),
          createElement(PagePanelSlot, { fallback: createElement('span', null, 'On this page') }),
        ),
      ),
    )
    expect(markup).toContain('Contextual example')
    expect(markup).toContain('On this page')
  })

  it('preserves the explicit inline panel alias', () => {
    const markup = renderToStaticMarkup(createElement(InlinePanel, { title: 'Configuration' }, 'Set the key.'))
    expect(markup).toContain('Configuration')
    expect(markup).toContain('Set the key.')
  })

  it('renders request and response examples with optional selection', () => {
    const request = renderToStaticMarkup(createElement(RequestExample, {
      dropdown: true,
    }, [
        createElement('pre', { key: 'curl', title: 'cURL' }, 'curl /projects'),
        createElement('pre', { key: 'node', title: 'Node.js' }, 'client.projects.list()'),
      ]))
    const response = renderToStaticMarkup(createElement(ResponseExample, null, createElement('pre', null, '{}')))
    expect(request).toContain('aria-label="Request example"')
    expect(request).toContain('cURL')
    expect(response).toContain('Response')
  })

  it('renders canonical prompt actions and preserves bare legacy Prompt terminals', () => {
    const canonical = renderToStaticMarkup(createElement(Prompt, {
      description: 'Add API examples', actions: ['copy', 'cursor'],
    }, 'Add one cURL example.'))
    const legacy = renderToStaticMarkup(createElement(Prompt, null,
      createElement(TerminalInput, null, 'npm run build'),
      createElement(TerminalOutput, null, 'Build completed.'),
    ))
    expect(canonical).toContain('Copy prompt')
    expect(canonical).toContain('cursor://')
    expect(legacy).toContain('npm run build')
    expect(legacy).toContain('Build completed.')
  })

  it('keeps all View content in SSR and rejects unsafe legacy embeds', () => {
    const views = renderToStaticMarkup(createElement(PageSlotsProvider, null,
      createElement(View, { title: 'Node.js' }, 'npm install'),
      createElement(View, { title: 'Python' }, 'pip install'),
    ))
    const unsafeEmbed = renderToStaticMarkup(createElement(Embed, { src: 'javascript:alert(1)' }))
    expect(views).toContain('npm install')
    expect(views).toContain('pip install')
    expect(unsafeEmbed).toBe('')
  })
})
