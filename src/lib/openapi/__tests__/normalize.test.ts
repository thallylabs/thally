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


describe('normalizeSpec dense $ref cycles', () => {
  // A clique of mutually-referencing schemas (like the large cycle in a real
  // API's object graph): every schema refs every other. Re-walking each
  // simple path through it is factorial; memoizing per truncation context
  // must keep it fast and produce the same path-specific placeholders.
  const SIZE = 9
  const schemas: Record<string, unknown> = {}
  const paths: Record<string, unknown> = {}
  for (let i = 0; i < SIZE; i++) {
    const properties: Record<string, unknown> = {}
    for (let j = 0; j < SIZE; j++) {
      if (j !== i) properties[`to${j}`] = { $ref: `#/components/schemas/S${j}` }
    }
    schemas[`S${i}`] = { type: 'object', properties }
    paths[`/s${i}`] = {
      get: {
        summary: `Get S${i}`,
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/S${i}` } } },
          },
        },
      },
    }
  }
  const denseSpec = { openapi: '3.1.0', info: { title: 'Dense', version: '1.0.0' }, paths, components: { schemas } }

  it('resolves every entry path with its own placeholders, and quickly', () => {
    const started = Date.now()
    const normalized = normalizeSpec({
      config: { ...baseConfig, source: { type: 'inline', document: denseSpec } },
      document: denseSpec,
    } as unknown as ResolvedSpec)
    expect(Date.now() - started).toBeLessThan(2000)

    for (let i = 0; i < SIZE; i++) {
      const schema = findResponseSchema(normalized, `/s${i}`)
      const next = (i + 1) % SIZE
      // Entered via S<i>: following to<next> then back to<i> closes the cycle on S<i>.
      expect(schema.properties[`to${next}`].properties[`to${i}`].description).toBe(`[Circular: S${i}]`)
    }
  })
})

describe('normalizeSpec pathological schemas', () => {
  function responseSchemaFor(schemas: Record<string, unknown>, root: string) {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Odd', version: '1.0.0' },
      paths: { '/x': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: `#/components/schemas/${root}` } } } } } } } },
      components: { schemas },
    }
    const normalized = normalizeSpec({ config: { ...baseConfig, source: { type: 'inline', document: doc } }, document: doc } as unknown as ResolvedSpec)
    return findResponseSchema(normalized, '/x')
  }

  it('resolves refs whose fragment is percent-encoded or uses ~ escapes', () => {
    const schema = responseSchemaFor({
      'Pet Store': { type: 'string' },
      'a/b': { type: 'integer' },
      Root: { properties: { a: { $ref: '#/components/schemas/Pet%20Store' }, b: { $ref: '#/components/schemas/a~1b' } } },
    }, 'Root')
    expect(schema.properties.a).toEqual({ type: 'string' })
    expect(schema.properties.b).toEqual({ type: 'integer' })
  })

  it('does not overflow the stack on extremely deep nesting', () => {
    let deep: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 8000; i++) deep = { type: 'object', properties: { child: deep } }
    expect(() => responseSchemaFor({ Root: deep }, 'Root')).not.toThrow()
  })

  it('gives up on a dense clique of mutually-referencing schemas instead of hanging', () => {
    const size = 12
    const schemas: Record<string, unknown> = {}
    for (let i = 0; i < size; i++) {
      const properties: Record<string, unknown> = {}
      for (let j = 0; j < size; j++) if (j !== i) properties[`to${j}`] = { $ref: `#/components/schemas/S${j}` }
      schemas[`S${i}`] = { type: 'object', properties }
    }
    const started = Date.now()
    responseSchemaFor(schemas, 'S0')
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
