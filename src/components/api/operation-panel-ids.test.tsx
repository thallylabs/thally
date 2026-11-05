import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'

const render = (operation: Record<string, unknown>) =>
  renderToStaticMarkup(
    <OperationPanel
      operation={operationFrom({
        openapi: '3.0.3',
        info: { title: 'T', version: '1' },
        servers: [{ url: 'https://api.example.com' }],
        paths: { '/things/{id}': { post: { summary: 'Thing', responses: {}, ...operation } } },
      })}
    />,
  )

const body = (schema: Record<string, unknown>, extra: Record<string, unknown> = {}) => render({ requestBody: { content: { 'application/json': { schema } } }, ...extra })
const response = (schema: Record<string, unknown>) => render({ responses: { '200': { description: 'ok', content: { 'application/json': { schema } } } } })
const ids = (html: string) => [...html.matchAll(/ id="((?:body|response|parameter)-[^"]*)"/g)].map((match) => match[1])

// Links written for Mintlify point at these ids: `#body-explicit-deposit`, `#response-requests-items-data-failed-tx-hash`.
describe('ids of the rows of a generated API page', () => {
  it('spell a body field as body- and its name in kebab case', () => {
    expect(ids(body({ type: 'object', properties: { explicitDeposit: { type: 'boolean' }, user_id: { type: 'string' }, tradeType: { type: 'string' } } }))).toEqual([
      'body-explicit-deposit',
      'body-user-id',
      'body-trade-type',
    ])
  })

  it('name a field nested in an array of objects with items, and the levels below it by their names', () => {
    const html = response({
      type: 'object',
      properties: { requests: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, data: { type: 'object', properties: { failedTxHash: { type: 'string' }, failedCallData: { type: 'string' } } } } } } },
    })
    expect(ids(html)).toEqual([
      'response-requests',
      'response-requests-items-id',
      'response-requests-items-data',
      'response-requests-items-data-failed-tx-hash',
      'response-requests-items-data-failed-call-data',
    ])
  })

  it('name the fields of a body that is a list of objects under items', () => {
    expect(ids(response({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } }))).toEqual(['response-items-id'])
  })

  it('name a parameter parameter- and its name, whichever place it is in', () => {
    const html = render({
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'chain_id', in: 'query', schema: { type: 'string' } },
        { name: 'X-Request-Id', in: 'header', schema: { type: 'string' } },
      ],
    })
    expect(ids(html)).toEqual(['parameter-id', 'parameter-chain-id', 'parameter-x-request-id'])
  })

  it('name a field that may be null as the first member of a union, and the fields below it by that', () => {
    const flag = body({ type: 'object', properties: { invoiceId: { type: 'string', nullable: true }, geo: { type: 'object', nullable: true, properties: { country: { type: 'string' } } } } })
    expect(ids(flag)).toEqual(['body-invoice-id-one-of-0', 'body-geo-one-of-0', 'body-geo-one-of-0-country'])
    const list = response({ type: 'object', properties: { item: { anyOf: [{ type: 'null' }, { type: 'object', properties: { name: { type: 'string' } } }] }, tags: { oneOf: [{ type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } }, { type: 'null' }] } } })
    expect(ids(list)).toEqual(['response-item-one-of-0', 'response-item-one-of-0-name', 'response-tags-one-of-0', 'response-tags-one-of-0-items-label'])
  })

  it('name the fields of each member of a union by its number, as one list of tabs', () => {
    const html = response({ oneOf: [{ type: 'object', properties: { status: { type: 'string' } } }, { type: 'object', properties: { message: { type: 'string' } } }] })
    expect(ids(html)).toEqual(['response-one-of-0-status'])
  })

  it('give no id to a second media type, a response that is not shown, or a nameless row', () => {
    const html = render({
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'string' } } } }, 'multipart/form-data': { schema: { type: 'object', properties: { a: { type: 'string' } } } } } },
      responses: {
        '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } }, 'text/plain': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
        '400': { description: 'bad', content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } } },
      },
    })
    expect(ids(html)).toEqual(['body-a', 'response-id'])
  })

  it('keep every id on the page unique, numbering a repeat in order', () => {
    const html = body({ type: 'object', properties: { userId: { type: 'string' }, user_id: { type: 'string' }, 'user-id': { type: 'string' } } }, { parameters: [{ name: 'userId', in: 'query', schema: { type: 'string' } }, { name: 'user_id', in: 'header', schema: { type: 'string' } }] })
    expect(ids(html)).toEqual(['parameter-user-id', 'parameter-user-id-2', 'body-user-id', 'body-user-id-2', 'body-user-id-3'])
  })
})
