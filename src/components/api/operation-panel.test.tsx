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

  it('omits its own description when the page header shows an authored one', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(document)} showDescription={false} />)
    expect(html).not.toContain('Scrape a URL')
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

describe('OperationPanel object defaults', () => {
  it('prints an object default as JSON, not [object Object]', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/x': {
          post: {
            summary: 'X',
            requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { opts: { type: 'object', default: {} } } } } } },
            responses: {},
          },
        },
      },
    }
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(spec)} />)
    expect(html).not.toContain('[object Object]')
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

describe('OperationPanel field descriptions', () => {
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
                    proxy: { type: 'string', description: 'Use `basic` or **auto**, see [docs](https://example.com/p). <script>alert(1)</script>' },
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

  it('renders descriptions as Markdown without injecting raw HTML', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(spec)} />)
    expect(html).toContain('<code>basic</code>')
    expect(html).toContain('<strong>auto</strong>')
    expect(html).toContain('href="https://example.com/p"')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('`basic`')
  })
})

describe('OperationPanel endpoint bar and servers', () => {
  const withServers = (servers: Array<{ url: string }>) => ({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    servers,
    paths: { '/scrape': { post: { summary: 'Scrape', responses: {} } } },
  })

  it('shows the path only, and a Servers block only when there are several servers', () => {
    const one = renderToStaticMarkup(<OperationPanel operation={operationFrom(withServers([{ url: 'https://api.example.com/v2' }]))} />)
    expect(one).toContain('>/scrape</code>')
    expect(one).not.toContain('Servers')
    expect(one).not.toContain('>https://api.example.com/v2/scrape<')
    const two = renderToStaticMarkup(
      <OperationPanel operation={operationFrom(withServers([{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }]))} />,
    )
    expect(two).toContain('Servers')
  })
})

describe('OperationPanel $ref path parameter', () => {
  it('lists the path parameter and keeps {id} visible in the sample URL until it is filled in', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      servers: [{ url: 'https://api.example.com/v2' }],
      paths: { '/monitor/{id}': { get: { summary: 'Get', parameters: [{ $ref: '#/components/parameters/Id' }], responses: {} } } },
      components: { parameters: { Id: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } } },
    }
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(spec)} />)
    expect(html).toContain('>id</code>')
    expect(html).toContain('--url https://api.example.com/v2/monitor/{id}')
    expect(html).not.toContain('%7Bid%7D')
  })
})

describe('OperationPanel code samples', () => {
  it('offers a language dropdown with the seven live languages, cURL first', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(document)} />)
    expect(html).toContain('aria-label="Select language"')
    const options = [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1])
    expect(options).toEqual(['cURL', 'Python', 'JavaScript', 'PHP', 'Go', 'Java', 'Ruby'])
    expect(html).toContain('curl --request POST')
  })
})
