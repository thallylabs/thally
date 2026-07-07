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
})

