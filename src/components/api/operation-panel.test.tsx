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
