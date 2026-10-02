import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'

const document = {
  openapi: '3.1.0',
  info: { title: 'T', version: '1' },
  servers: [{ url: 'https://api.example.com/v2' }],
  paths: {
    '/scrape': { post: { summary: 'Scrape a URL', tags: ['Scrape'], responses: { '200': { description: 'ok' } } } },
  },
}

describe('OperationPanel header', () => {
  it('renders no heading of its own and the description once', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(document)} />)
    expect(html).not.toContain('<h1')
    expect(html.match(/Scrape a URL/g)).toHaveLength(1)
  })
})

describe('OperationPanel webhook', () => {
  const hook = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {},
    webhooks: {
      crawlPage: {
        post: {
          summary: 'Crawl Page',
          requestBody: { content: { 'application/json': { schema: { type: 'object' }, example: { type: 'crawl.page' } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }

  it('is labelled a webhook, has no Try it or cURL, and shows the payload example', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(hook, true)} />)
    expect(html).toContain('Webhook')
    expect(html).not.toContain('Try it')
    expect(html).not.toContain('curl')
    expect(html).toContain('&quot;type&quot;: &quot;crawl.page&quot;')
  })
})

describe('OperationPanel field details', () => {
  const spec = {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/x': {
        post: {
          summary: 'X',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    mode: { type: 'string', enum: ['a', 'b'] },
                    modes: { type: 'array', items: { type: 'string', enum: ['a'] } },
                    kind: { type: 'string', const: 'crawl.page' },
                    old: { type: 'boolean', deprecated: true },
                  },
                },
              },
            },
          },
          responses: {},
        },
      },
    },
  }

  it('shows format, enum, const and a deprecated badge in the field types', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(spec)} />)
    expect(html).toContain('string&lt;uuid&gt;')
    expect(html).toContain('enum&lt;string&gt;<')
    expect(html).toContain('enum&lt;string&gt;[]')
    expect(html).toContain('Allowed value: <code>&quot;crawl.page&quot;</code>')
    expect(html).toContain('>deprecated<')
  })
})
