import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'

const render = (operation: Record<string, unknown>) =>
  renderToStaticMarkup(
    <OperationPanel
      operation={operationFrom({
        openapi: '3.0.1',
        info: { title: 'T', version: '1' },
        servers: [{ url: 'https://api.example.com' }],
        paths: { '/things/{email}': { post: { summary: 'Thing', responses: {}, ...operation } } },
      })}
    />,
  )

describe('parameter rows', () => {
  it('show the description that sits on the parameter schema', () => {
    const html = render({
      parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', description: 'The email of the user invited.' } }],
    })
    expect(html).toContain('The email of the user invited.')
  })

  it('prefer the parameter description over the schema one', () => {
    const html = render({
      parameters: [{ name: 'email', in: 'path', required: true, description: 'Parameter text.', schema: { type: 'string', description: 'Schema text.' } }],
    })
    expect(html).toContain('Parameter text.')
    expect(html).not.toContain('Schema text.')
  })

  it('add no empty description block to a parameter that has neither description nor values', () => {
    const html = render({ parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }] })
    expect(html).toContain('limit')
    expect(html).not.toContain('mt-2.5')
  })

  it('list the allowed values of a query parameter', () => {
    const html = render({
      parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['all', 'upcoming', 'issued'] } }],
    })
    expect(html).toContain('Allowed: all, upcoming, issued')
  })
})

describe('body field rows', () => {
  const body = (properties: Record<string, unknown>) => ({
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties } } } },
  })

  it('list the allowed values of an array of enum items', () => {
    const html = render(body({ scopes: { type: 'array', items: { type: 'string', enum: ['read', 'db:create'] } } }))
    expect(html).toContain('Allowed: read, db:create')
  })

  it('list the allowed values of the first union member that has any', () => {
    const html = render(
      body({
        extensions: {
          oneOf: [
            { type: 'string', enum: ['all'] },
            { type: 'array', items: { type: 'string', enum: ['vector', 'uuid'] } },
          ],
        },
      }),
    )
    expect(html).toContain('Allowed: all<')
    expect(html).not.toContain('vector')
  })

  it('still list the values of a plain enum once', () => {
    const html = render(body({ role: { type: 'string', enum: ['admin', 'member'] } }))
    expect(html.match(/Allowed: admin, member/g)).toHaveLength(1)
  })
})
