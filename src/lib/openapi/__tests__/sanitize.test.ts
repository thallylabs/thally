/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed spec fixtures */
import { describe, expect, it } from 'vitest'
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'
import type { OpenAPIDocument } from '@/lib/openapi/types'

const ref = (name: string, type = 'schemas') => ({ $ref: `#/components/${type}/${name}` })
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } })

function baseSpec(): Record<string, any> {
  return {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    tags: [{ name: 'public' }, { name: 'internal' }, { name: 'shared' }],
    paths: {
      '/pub': { get: { tags: ['public', 'shared'], responses: { 200: json(ref('Pub')) } } },
      '/secret': {
        get: { 'x-excluded': true, tags: ['internal', 'shared'], responses: { 200: json(ref('Secret')) } },
        post: { tags: ['public'], responses: { 200: json(ref('Pub')) } },
      },
    },
    components: {
      schemas: {
        Pub: { type: 'object', properties: { shared: ref('Shared') } },
        Shared: { type: 'string' },
        Secret: { type: 'object', properties: { inner: ref('SecretInner'), shared: ref('Shared') } },
        SecretInner: { type: 'object', properties: { back: ref('Secret') } },
        Unused: { type: 'string' },
      },
      securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'k' } },
    },
  }
}

describe('sanitizeSpecForPublication', () => {
  it('removes op-level x-excluded, keeps sibling ops, prunes exclusive schemas (circular ok)', () => {
    const out = sanitizeSpecForPublication(baseSpec() as OpenAPIDocument) as Record<string, any>
    expect(out.paths['/secret'].get).toBeUndefined()
    expect(out.paths['/secret'].post).toBeDefined()
    expect(Object.keys(out.components.schemas).sort()).toEqual(['Pub', 'Shared', 'Unused'])
    expect(out.components.securitySchemes.key).toBeDefined()
    expect(JSON.stringify(out)).not.toContain('Secret')
  })

  it('drops a tag only used by removed ops', () => {
    const out = sanitizeSpecForPublication(baseSpec() as OpenAPIDocument) as Record<string, any>
    expect(out.tags.map((t: any) => t.name)).toEqual(['public', 'shared'])
  })

  it('removes path-level exclusions and string "true"', () => {
    const spec = baseSpec()
    spec.paths['/secret'] = { 'x-excluded': 'true', get: {}, post: {} }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(out.paths['/secret']).toBeUndefined()
  })

  it('removes x-hidden ops (op and path level) and drops emptied path items', () => {
    const spec = baseSpec()
    spec.paths['/secret'] = { get: { 'x-hidden': true, responses: {} } }
    spec.paths['/h'] = { 'x-hidden': true, get: {} }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.paths)).toEqual(['/pub'])
  })

  it('removes excluded webhooks and x-webhooks and their schemas', () => {
    const spec = baseSpec()
    spec.webhooks = {
      hook: { post: { 'x-excluded': true, requestBody: json(ref('Secret')) } },
      ok: { post: { requestBody: json(ref('Pub')) } },
    }
    spec['x-webhooks'] = { hook2: { 'x-excluded': true, post: {} } }
    spec.paths['/secret'].get['x-excluded'] = false
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.webhooks)).toEqual(['ok'])
    expect(out['x-webhooks']).toEqual({})
  })

  it('honours docs.json overrides hidden', () => {
    const spec = baseSpec()
    delete spec.paths['/secret'].get['x-excluded']
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument, {
      overrides: { 'GET /secret': { hidden: true } },
    }) as Record<string, any>
    expect(out.paths['/secret'].get).toBeUndefined()
    expect(out.components.schemas.Secret).toBeUndefined()
  })

  it('keeps schemas shared with kept ops and follows transitive refs', () => {
    const spec = baseSpec()
    spec.paths['/pub'].get.responses[200] = json(ref('Secret'))
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.components.schemas).sort()).toEqual(['Pub', 'Secret', 'SecretInner', 'Shared', 'Unused'])
  })

  it('prunes other component types and discriminator mappings', () => {
    const spec = baseSpec()
    spec.components.parameters = { P: { name: 'p', in: 'query', schema: ref('Shared') } }
    spec.components.responses = { R: { description: 'r', ...json(ref('Secret')) } }
    spec.paths['/secret'].get.parameters = [ref('P', 'parameters')]
    spec.paths['/secret'].get.responses[404] = ref('R', 'responses')
    spec.components.schemas.Pub.discriminator = { propertyName: 't', mapping: { a: '#/components/schemas/Shared' } }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(out.components.parameters.P).toBeUndefined()
    expect(out.components.responses.R).toBeUndefined()
    expect(out.components.schemas.Shared).toBeDefined()
  })

  it('returns the document unchanged when nothing is excluded', () => {
    const spec = baseSpec()
    delete spec.paths['/secret'].get['x-excluded']
    spec.paths['/pub'].get['x-excluded'] = false
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument)
    expect(out).toBe(spec)
    expect(out).toEqual(baseSpecWithoutFlag())
  })

  it('drops a $ref-ed component path item hidden only by a docs.json override key', () => {
    const spec = baseSpec()
    spec.paths['/via-ref'] = { $ref: '#/components/pathItems/Shared' }
    spec.components.pathItems = { Shared: { get: { tags: ['internal'], responses: { 200: json(ref('Secret')) } } } }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument, {
      overrides: { 'GET /via-ref': { hidden: true } },
    }) as Record<string, any>
    expect(out.paths['/via-ref']).toBeUndefined()
    expect(out.components.pathItems?.Shared?.get).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('SecretInner')
  })

  it('does not mutate the input', () => {
    const spec = baseSpec()
    sanitizeSpecForPublication(spec as OpenAPIDocument)
    expect(spec).toEqual(baseSpec())
  })
})

function baseSpecWithoutFlag() {
  const spec = baseSpec()
  delete spec.paths['/secret'].get['x-excluded']
  spec.paths['/pub'].get['x-excluded'] = false
  return spec
}
