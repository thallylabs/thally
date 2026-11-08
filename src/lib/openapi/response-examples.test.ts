import { describe, expect, it } from 'vitest'
import { operationFrom } from '@/components/api/test-fixtures'
import { formatExample, responseExamples } from '@/lib/openapi/response-examples'

const json = (media: Record<string, unknown>) => ({ content: { 'application/json': media } })
const responses = (spec: Record<string, unknown>) =>
  operationFrom({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: { '/x': { post: { responses: spec } } },
  }).responses

describe('responseExamples', () => {
  it('uses the spec example as written', () => {
    const [ok] = responses({ '200': { description: 'ok', ...json({ schema: { type: 'object' }, example: { id: 'a' } }) } })
    expect(responseExamples(ok)).toEqual([{ key: 'example', label: 'Example', value: { id: 'a' } }])
  })

  it('lists every named example, labelled by summary or key', () => {
    const [ok] = responses({
      '200': { description: 'ok', ...json({ examples: { one: { summary: 'First', value: { n: 1 } }, two: { value: { n: 2 } } } }) },
    })
    expect(responseExamples(ok).map((e) => [e.key, e.label, e.value])).toEqual([
      ['one', 'First', { n: 1 }],
      ['two', 'two', { n: 2 }],
    ])
  })

  it('builds one from the schema when the spec has none, so error statuses are not empty', () => {
    const schema = {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' },
        id: { type: 'string', format: 'uuid' },
        at: { type: 'string', format: 'date-time' },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    }
    const [ok, limited] = responses({ '200': { description: 'ok', ...json({ schema }) }, '429': { description: 'slow down', ...json({ schema }) } })
    for (const response of [ok, limited]) {
      expect(responseExamples(response)[0].value).toEqual({
        success: true,
        error: '<string>',
        id: '3c90c3cc-0d44-4b50-8888-8dd25736052a',
        at: '2023-11-07T05:31:56Z',
        count: 123,
        tags: ['<string>'],
      })
    }
  })

  it('samples a nullable union by its first branch that is not null', () => {
    const schema = {
      type: 'object',
      properties: {
        first: { anyOf: [{ type: 'null' }, { type: 'object', properties: { id: { type: 'string' } } }] },
        last: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        list: { type: ['array', 'null'], items: { type: 'string' } },
        count: { type: ['integer', 'null'] },
      },
    }
    const [ok] = responses({ '200': { description: 'ok', ...json({ schema }) } })
    expect(responseExamples(ok)[0].value).toEqual({ first: { id: '<string>' }, last: 123, list: ['<string>'], count: 123 })
  })

  it('has no example for a response without a body', () => {
    expect(responseExamples(responses({ '204': { description: 'gone' } })[0])).toEqual([])
  })

  it('formats JSON strings and values alike', () => {
    expect(formatExample('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(formatExample({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})
