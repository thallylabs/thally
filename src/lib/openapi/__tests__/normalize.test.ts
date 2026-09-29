import { describe, expect, it } from 'vitest'
import { normalizeSpec, buildOperationKey } from '@/lib/openapi/normalize'
import type { ApiSpecConfig, ResolvedSpec } from '@/lib/openapi/types'

const baseConfig: ApiSpecConfig = {
  id: 'test',
  label: 'Test API',
  source: { type: 'inline', document: {} },
  tagsOrder: ['plants', 'webhooks'],
  defaultGroup: 'Core',
  webhookGroup: 'Webhooks',
  operationOverrides: {
    'GET /plants': { title: 'List plants', description: 'Fetch plants', badge: 'Stable' },
    'POST /plants': { title: 'Create plant', description: 'Create a plant entry' },
    'DELETE /plants/{id}': { title: 'Delete plant', description: 'Remove a plant' },
    'WEBHOOK POST /plant/webhook': { group: 'Webhooks', badge: 'Webhook' },
  },
}
const plantStoreSpec = {
  openapi: '3.1.0',
  info: { title: 'Plant Store', version: '1.0.0' },
  servers: [{ url: 'http://sandbox.mintlify.com' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/plants': {
      get: {
        summary: 'List plants',
        description: 'Returns all plants from the system that the user has access to',
        tags: ['plants'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'The maximum number of results to return',
            schema: { type: 'integer', format: 'int32' },
          },
        ],
        responses: {
          '200': {
            description: 'Plant response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Plant' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create plant',
        description: 'Creates a new plant in the store',
        tags: ['plants'],
        requestBody: {
          description: 'Plant to add to the store',
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPlant' } } },
        },
        responses: {
          '200': {
            description: 'Plant response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Plant' } } },
          },
        },
      },
    },
    '/plants/{id}': {
      delete: {
        summary: 'Delete plant',
        description: 'Deletes a single plant based on the ID supplied',
        tags: ['plants'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'ID of plant to delete',
            schema: { type: 'integer', format: 'int64' },
          },
        ],
        responses: { '204': { description: 'Plant deleted' } },
      },
    },
  },
  webhooks: {
    '/plant/webhook': {
      post: {
        summary: 'Plant webhook',
        description: 'Information about a new plant added to the store',
        tags: ['webhooks'],
        requestBody: {
          description: 'Plant added to the store',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPlant' } } },
        },
        responses: { '200': { description: 'Webhook accepted' } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Plant: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          tag: { type: 'string' },
        },
      },
      NewPlant: {
        allOf: [
          { $ref: '#/components/schemas/Plant' },
          {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer', format: 'int64' },
            },
          },
        ],
      },
    },
  },
} as const

function createResolvedSpec(): ResolvedSpec {
  const inlineSource: ApiSpecConfig = {
    ...baseConfig,
    source: { type: 'inline', document: plantStoreSpec },
  }
  return {
    config: inlineSource,
    document: plantStoreSpec,
  }
}

describe('normalizeSpec', () => {
  it('builds operations with overrides applied', () => {
    const normalized = normalizeSpec(createResolvedSpec())
    expect(normalized.operations).toHaveLength(4)

    const listPlants = normalized.operations.find(
      (operation) => operation.key === buildOperationKey('GET', '/plants'),
    )
    expect(listPlants?.title).toBe('List plants')
    expect(listPlants?.group).toBe('plants')
    expect(listPlants?.parameters.query).toHaveLength(1)
    expect(listPlants?.parameters.query[0]).toMatchObject({
      name: 'limit',
      in: 'query',
      required: false,
    })
  })

  it('normalizes webhook operations', () => {
    const normalized = normalizeSpec(createResolvedSpec())
    const webhook = normalized.operations.find((operation) => operation.isWebhook)
    expect(webhook).toBeDefined()
    expect(webhook?.group).toBe('Webhooks')
    expect(webhook?.servers).toHaveLength(1)
  })

  it('captures responses and media types', () => {
    const normalized = normalizeSpec(createResolvedSpec())
    const createPlant = normalized.operations.find(
      (operation) => operation.key === buildOperationKey('POST', '/plants'),
    )
    expect(createPlant?.responses).not.toHaveLength(0)
    const successResponse = createPlant?.responses.find((response) => response.code === '200')
    expect(successResponse?.contents[0]?.mediaType).toBe('application/json')
  })

  it('keeps document-level security when operation does not define it', () => {
    const normalized = normalizeSpec(createResolvedSpec())
    const anyOperation = normalized.operations[0]
    expect(anyOperation.security[0][0].name).toBe('bearerAuth')
  })

  describe('x-excluded / x-hidden', () => {
    const responses = { '200': { description: 'ok' } }
    const build = (document: Record<string, unknown>, config: Partial<ApiSpecConfig> = {}) =>
      normalizeSpec({
        config: { ...baseConfig, operationOverrides: {}, ...config },
        document: { openapi: '3.1.0', info: { title: 't', version: '1' }, ...document },
      } as unknown as ResolvedSpec)
    const keys = (n: ReturnType<typeof normalizeSpec>) => n.operations.map((o) => o.key).sort()

    it('drops operations with x-excluded on the operation', () => {
      const n = build({
        paths: {
          '/a': { get: { tags: ['t'], responses, 'x-excluded': true }, post: { tags: ['t'], responses } },
        },
      })
      expect(keys(n)).toEqual(['POST /a'])
    })

    it('drops all operations for path-level x-excluded', () => {
      const n = build({
        paths: {
          '/a': { 'x-excluded': true, get: { responses }, post: { responses } },
          '/b': { get: { responses } },
        },
      })
      expect(keys(n)).toEqual(['GET /b'])
    })

    it('drops excluded webhooks', () => {
      const n = build({
        paths: {},
        webhooks: { hook: { post: { responses, 'x-excluded': true } }, hook2: { post: { responses } } },
      })
      expect(keys(n)).toEqual(['WEBHOOK POST hook2'])
    })

    it('treats x-hidden like an override hidden, and accepts string "true"', () => {
      const n = build({
        paths: {
          '/a': { get: { responses, 'x-hidden': true } },
          '/b': { get: { responses } },
          '/c': { get: { responses, 'x-hidden': 'true' } },
        },
      })
      const viaOverride = build(
        { paths: { '/a': { get: { responses } } } },
        { operationOverrides: { 'GET /a': { hidden: true } } },
      )
      expect(n.operations.find((o) => o.key === 'GET /a')?.hidden).toBe(true)
      expect(n.operations.find((o) => o.key === 'GET /a')?.hidden).toBe(viaOverride.operations[0].hidden)
      expect(n.operations.find((o) => o.key === 'GET /c')?.hidden).toBe(true)
      expect(n.operations.find((o) => o.key === 'GET /b')?.hidden).toBe(false)
    })

    it('is a no-op when false', () => {
      const n = build({ paths: { '/a': { get: { responses, 'x-excluded': false, 'x-hidden': false } } } })
      expect(n.operations).toHaveLength(1)
      expect(n.operations[0].hidden).toBe(false)
    })

    it('leaves no group for a tag whose operations are all excluded', () => {
      const n = build({
        paths: {
          '/a': { get: { tags: ['gone'], responses, 'x-excluded': true } },
          '/b': { get: { tags: ['kept'], responses } },
        },
      })
      expect(n.operations.map((o) => o.group)).toEqual(['kept'])
    })

    it('still resolves schemas referenced by kept operations', () => {
      const n = build({
        paths: {
          '/a': { get: { responses, 'x-excluded': true } },
          '/b': {
            get: {
              responses: {
                '200': {
                  description: 'ok',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
                },
              },
            },
          },
        },
        components: { schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } } },
      })
      const schema = n.operations[0].responses[0].contents[0].schema as { properties?: Record<string, unknown> }
      expect(schema.properties).toHaveProperty('id')
    })
  })
})
