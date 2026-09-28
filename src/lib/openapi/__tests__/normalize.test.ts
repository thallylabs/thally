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

const circularSpec = {
  openapi: '3.1.0',
  info: { title: 'Circular API', version: '1.0.0' },
  paths: {
    '/nodes': {
      get: {
        summary: 'Get node',
        responses: {
          '200': {
            description: 'Node response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
          },
        },
      },
    },
    '/a': {
      get: {
        summary: 'Get A',
        responses: {
          '200': {
            description: 'A response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
          },
        },
      },
    },
    '/b': {
      get: {
        summary: 'Get B',
        responses: {
          '200': {
            description: 'B response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/B' } } },
          },
        },
      },
    },
    '/shared1': {
      get: {
        summary: 'Get shared 1',
        responses: {
          '200': {
            description: 'Shared response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } },
          },
        },
      },
    },
    '/shared2': {
      get: {
        summary: 'Get shared 2',
        responses: {
          '200': {
            description: 'Shared response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } },
          },
        },
      },
    },
    '/shared3': {
      get: {
        summary: 'Get shared 3',
        responses: {
          '200': {
            description: 'Shared response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      // Self-referencing: Node.children is an array of Node.
      Node: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/Node' },
          },
        },
      },
      // Mutual cycle: A -> B -> A.
      A: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          b: { $ref: '#/components/schemas/B' },
        },
      },
      B: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          a: { $ref: '#/components/schemas/A' },
        },
      },
      // No cycle — referenced by three different operations.
      Shared: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          value: { type: 'number' },
        },
      },
    },
  },
} as const

function createCircularResolvedSpec(): ResolvedSpec {
  return {
    config: { ...baseConfig, source: { type: 'inline', document: circularSpec } },
    document: circularSpec,
  }
}

interface LooseSchema {
  type?: string
  description?: string
  properties: Record<string, LooseSchema>
  items: LooseSchema
}

function findResponseSchema(normalized: ReturnType<typeof normalizeSpec>, path: string): LooseSchema {
  const operation = normalized.operations.find((op) => op.path === path)
  const schema = operation?.responses.find((response) => response.code === '200')?.contents[0]?.schema
  return schema as unknown as LooseSchema
}

describe('normalizeSpec circular $ref resolution', () => {
  it('terminates and places a placeholder for a self-referencing schema', () => {
    const normalized = normalizeSpec(createCircularResolvedSpec())
    const nodeSchema = findResponseSchema(normalized, '/nodes')
    expect(nodeSchema.properties.children.items.description).toBe('[Circular: Node]')
  })

  it('terminates and places a placeholder for a mutual cycle (A -> B -> A)', () => {
    const normalized = normalizeSpec(createCircularResolvedSpec())
    const aSchema = findResponseSchema(normalized, '/a')
    expect(aSchema.properties.b.properties.a.description).toBe('[Circular: A]')
  })

  it('resolves a shared schema identically for every operation that references it', () => {
    const normalized = normalizeSpec(createCircularResolvedSpec())
    const shared1 = findResponseSchema(normalized, '/shared1')
    const shared2 = findResponseSchema(normalized, '/shared2')
    const shared3 = findResponseSchema(normalized, '/shared3')
    expect(shared1).toEqual({
      type: 'object',
      properties: { id: { type: 'string' }, value: { type: 'number' } },
    })
    expect(shared2).toEqual(shared1)
    expect(shared3).toEqual(shared1)
    // Memoized: every operation gets back the exact same resolved object.
    expect(shared2).toBe(shared1)
    expect(shared3).toBe(shared1)
  })

  it('resolves the same cycle correctly from two different entry paths (A first, then B)', () => {
    const normalized = normalizeSpec(createCircularResolvedSpec())
    const aSchema = findResponseSchema(normalized, '/a')
    const bSchema = findResponseSchema(normalized, '/b')

    // Entering via A: the cycle closes back on A.
    expect(aSchema.properties.b.properties.a.description).toBe('[Circular: A]')
    expect(aSchema.properties.b.properties.a.type).toBe('object')

    // Entering via B: the cycle closes back on B, not on whatever A's
    // resolution happened to produce first. A memo cache keyed only by ref
    // (with no regard for which `seen` context produced the cached value)
    // would incorrectly reuse A's truncated result here.
    expect(bSchema.properties.a.properties.b.description).toBe('[Circular: B]')
    expect(bSchema.properties.a.properties.b.type).toBe('object')
  })
})

