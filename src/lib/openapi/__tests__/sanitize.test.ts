/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed spec fixtures */
import { describe, expect, it } from 'vitest'
import { sanitizeSpecForPublication } from '@/lib/openapi/sanitize'
import { normalizeSpec } from '@/lib/openapi/normalize'
import type { OpenAPIDocument, ResolvedSpec } from '@/lib/openapi/types'

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

  it('follows discriminator mappings that name schemas without a $ref', () => {
    const spec = baseSpec()
    // Hidden-only: reached solely through a bare-name mapping on the hidden op's schema.
    spec.paths['/secret'].get['x-hidden'] = true
    spec.components.schemas.Secret.discriminator = {
      propertyName: 'kind',
      mapping: { child: 'SecretChild', tilde: 'Odd~Name', external: 'other.yaml#/Remote', ref: '#/components/schemas/SecretRefChild' },
    }
    spec.components.schemas.SecretChild = { type: 'object', description: 'internal child', properties: { grand: ref('SecretGrandchild') } }
    spec.components.schemas.SecretGrandchild = { type: 'string', description: 'internal grandchild' }
    spec.components.schemas['Odd~Name'] = { type: 'string' }
    spec.components.schemas.SecretRefChild = { type: 'string' }
    // Public: the same bare-name form on a schema a public endpoint uses.
    spec.components.schemas.Pub.discriminator = { propertyName: 'kind', mapping: { child: 'PubChild' } }
    spec.components.schemas.PubChild = { type: 'object', properties: { shared: ref('Shared') } }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.components.schemas).sort()).toEqual(['Pub', 'PubChild', 'Shared', 'Unused'])
    expect(JSON.stringify(out)).not.toMatch(/internal (grand)?child/)
  })

  it('keeps a bare-name mapping target that a public endpoint still reaches', () => {
    const spec = baseSpec()
    spec.components.schemas.Secret.discriminator = { propertyName: 'kind', mapping: { child: 'SharedChild' } }
    spec.components.schemas.Pub.discriminator = { propertyName: 'kind', mapping: { child: 'SharedChild' } }
    spec.components.schemas.SharedChild = { type: 'string' }
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(out.components.schemas.SharedChild).toBeDefined()
    expect(out.components.schemas.Secret).toBeUndefined()
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

describe('path item $refs (sanitize and normalize agree)', () => {
  const ok = { responses: { 200: { description: 'ok' } } }
  const doc = (extra: Record<string, any>): Record<string, any> => ({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {},
    ...extra,
  })
  const shared = (over: Record<string, any> = {}) => ({ pathItems: { Shared: { get: { ...ok, ...over } } } })
  const pi = (name = 'Shared') => ({ $ref: `#/components/pathItems/${name}` })
  const nav = (document: Record<string, any>, overrides: Record<string, any> = {}) =>
    normalizeSpec({
      config: { id: 'x', label: 'X', source: { type: 'inline', document }, operationOverrides: overrides },
      document,
    } as unknown as ResolvedSpec).operations.filter((o) => !o.hidden).map((o) => o.key).sort()
  const run = (document: Record<string, any>, overrides: Record<string, any> = {}) => {
    const out = sanitizeSpecForPublication(document as OpenAPIDocument, { overrides }) as Record<string, any>
    // Whatever survives publication must show in nav, and nothing else may.
    expect(nav(out, overrides)).toEqual(nav(document, overrides))
    return out
  }

  it('hides a path with x-hidden next to $ref (reviewer repro: /private)', () => {
    const spec = doc({ paths: { '/private': { ...pi(), 'x-hidden': true }, '/open': { get: ok } }, components: shared() })
    const out = run(spec)
    expect(Object.keys(out.paths)).toEqual(['/open'])
    expect(out.components.pathItems).toEqual({})
    expect(nav(spec)).toEqual(['GET /open'])
  })

  it('x-excluded next to $ref drops the path; string "true" works', () => {
    for (const flag of [true, 'true']) {
      const out = run(doc({ paths: { '/p': { ...pi(), 'x-excluded': flag } }, components: shared() }))
      expect(out.paths).toEqual({})
    }
  })

  it('a hidden override on one of two paths sharing an item leaves the other intact (reviewer repro)', () => {
    const spec = doc({ paths: { '/public': pi(), '/hidden': pi() }, components: shared() })
    const out = run(spec, { 'GET /hidden': { hidden: true } })
    expect(Object.keys(out.paths)).toEqual(['/public'])
    expect(out.paths['/public']).toEqual(pi())
    expect(out.components.pathItems.Shared.get).toBeDefined()
    expect(nav(spec, { 'GET /hidden': { hidden: true } })).toEqual(['GET /public'])
  })

  it('a sibling flag on one of two paths sharing an item leaves the other intact', () => {
    const spec = doc({ paths: { '/public': pi(), '/hidden': { ...pi(), 'x-hidden': true } }, components: shared() })
    const out = run(spec)
    expect(out.paths).toEqual({ '/public': pi() })
    expect(out.components.pathItems.Shared.get).toBeDefined()
  })

  it('an override hiding one method filters only that path, keeping the others as a copy', () => {
    const spec = doc({
      paths: { '/a': { ...pi(), summary: 'kept' }, '/b': pi() },
      components: { pathItems: { Shared: { get: ok, post: ok } } },
    })
    const out = run(spec, { 'POST /a': { hidden: true } })
    expect(out.paths['/a']).toMatchObject({ summary: 'kept', get: ok })
    expect(out.paths['/a'].$ref).toBeUndefined()
    expect(out.paths['/a'].post).toBeUndefined()
    expect(out.paths['/b']).toEqual(pi())
    expect(out.components.pathItems.Shared.post).toBeDefined()
  })

  it('override keyed to one path does not apply to a path sharing the item', () => {
    const spec = doc({ paths: { '/a': pi(), '/b': pi() }, components: shared() })
    const out = run(spec, { 'GET /a': { hidden: true } })
    expect(Object.keys(out.paths)).toEqual(['/b'])
  })

  it('override hidden:false wins over an item-level x-hidden', () => {
    const spec = doc({
      paths: { '/a': pi(), '/b': pi() },
      components: { pathItems: { Shared: { 'x-hidden': true, get: ok } } },
    })
    const out = run(spec, { 'GET /a': { hidden: false } })
    expect(Object.keys(out.paths)).toEqual(['/a'])
  })

  it('x-excluded on the referenced item applies to every referrer; op-level flag applies too', () => {
    const out = run(doc({ paths: { '/a': pi(), '/b': pi() }, components: { pathItems: { Shared: { 'x-excluded': true, get: ok } } } }))
    expect(out.paths).toEqual({})
    const out2 = run(doc({ paths: { '/a': pi(), '/b': pi() }, components: shared({ 'x-hidden': true }) }))
    expect(out2.paths).toEqual({})
    expect(out2.components.pathItems).toEqual({})
  })

  it('follows ref chains and #/paths aliases without dangling', () => {
    const spec = doc({
      paths: {
        '/real': { ...pi('B'), 'x-hidden': true },
        '/alias': { $ref: '#/paths/~1real' },
        '/chain': pi('A'),
        '/other': { get: ok },
      },
      components: { pathItems: { A: pi('B'), B: { get: ok } } },
    })
    const out = run(spec)
    expect(Object.keys(out.paths).sort()).toEqual(['/chain', '/other'])
  })

  it('a flag on the target path also hides an alias (flag lives on the referenced item)', () => {
    const spec = doc({ paths: { '/real': { 'x-hidden': true, get: ok }, '/alias': { $ref: '#/paths/~1real' } } })
    expect(Object.keys(run(spec).paths)).toEqual([])
  })

  it('an alias of a filtered path is inlined, not left dangling', () => {
    const spec = doc({
      paths: { '/real': { ...pi(), 'x-hidden': true }, '/alias': { $ref: '#/paths/~1real' } },
      components: shared(),
    })
    expect(run(spec).paths).toEqual({})
    const s2 = doc({
      paths: { '/real': { get: ok, post: ok }, '/alias': { $ref: '#/paths/~1real' } },
    })
    const out = run(s2, { 'POST /real': { hidden: true } })
    expect(out.paths['/real'].post).toBeUndefined()
    expect(out.paths['/alias']).toMatchObject({ get: ok, post: ok })
  })

  it('handles webhooks and x-webhooks the same way', () => {
    const spec = doc({
      webhooks: { hidden: { ...pi(), 'x-hidden': true }, open: pi(), viaOverride: pi() },
      'x-webhooks': { legacy: { ...pi(), 'x-excluded': true } },
      components: shared(),
    })
    const out = run(spec, { 'WEBHOOK GET viaOverride': { hidden: true } })
    expect(Object.keys(out.webhooks)).toEqual(['open'])
    expect(out['x-webhooks']).toEqual({})
  })

  it('prunes a pathItem only when no path references it any more', () => {
    const both = doc({ paths: { '/a': { ...pi(), 'x-hidden': true }, '/b': pi() }, components: shared() })
    expect(run(both).components.pathItems.Shared).toBeDefined()
    const none = doc({ paths: { '/a': { ...pi(), 'x-hidden': true } }, components: shared() })
    expect(run(none).components.pathItems.Shared).toBeUndefined()
  })

  it('does not mutate a shared inline object (yaml anchors) or the input', () => {
    const sharedObj = { get: ok, post: ok }
    const spec = doc({ paths: { '/a': sharedObj, '/b': sharedObj } })
    const copy = structuredClone(spec)
    const out = run(spec, { 'POST /a': { hidden: true } })
    expect(out.paths['/b'].post).toBeDefined()
    expect(out.paths['/a'].post).toBeUndefined()
    expect(spec).toEqual(copy)
  })

  it('removes the path when every method is removed', () => {
    const spec = doc({ paths: { '/a': { $ref: '#/components/pathItems/Two' } }, components: { pathItems: { Two: { get: ok, put: ok } } } })
    const out = run(spec, { 'GET /a': { hidden: true }, 'PUT /a': { hidden: true } })
    expect(out.paths).toEqual({})
  })

  it('never crashes on external, missing or circular refs; honours the entry flag, keeps unflagged entries', () => {
    const spec = doc({
      paths: {
        '/ext-hidden': { $ref: 'other.yaml#/paths/x', 'x-hidden': true },
        '/ext-excluded': { $ref: 'https://example.com/x.yaml', 'x-excluded': true },
        '/ext-open': { $ref: 'other.yaml#/paths/y' },
        '/missing-hidden': { $ref: '#/components/pathItems/Nope', 'x-hidden': true },
        '/loop-hidden': { $ref: '#/paths/~1loop-b', 'x-hidden': true },
        '/loop-b': { $ref: '#/paths/~1loop-hidden' },
        '/fine': { get: ok },
      },
    })
    const out = sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.paths).sort()).toEqual(['/ext-open', '/fine'])
    expect(() => nav(spec)).not.toThrow()
  })

  it('a hidden path item with an op-level x-hidden and no references is stripped from components', () => {
    const spec = doc({ paths: { '/a': { get: ok } }, components: shared({ 'x-hidden': true }) })
    const out = run(spec)
    expect(out.components.pathItems).toEqual({})
  })
})

describe('Swagger 2.0 documents', () => {
  const swagger = (): Record<string, any> => ({
    swagger: '2.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/pub': { get: { parameters: [{ $ref: '#/parameters/Shared' }], responses: { 200: { schema: { $ref: '#/definitions/Pub' } } } } },
      '/secret': {
        get: {
          'x-excluded': true,
          parameters: [{ $ref: '#/parameters/SecretParam' }],
          responses: { 200: { schema: { $ref: '#/definitions/Secret' } }, 404: { $ref: '#/responses/SecretMissing' } },
        },
      },
    },
    definitions: { Pub: { type: 'object' }, Secret: { type: 'object', properties: { inner: { $ref: '#/definitions/Inner' } } }, Inner: { type: 'string' } },
    parameters: { Shared: { name: 's', in: 'query', type: 'string' }, SecretParam: { name: 'x', in: 'query', type: 'string' } },
    responses: { SecretMissing: { description: 'gone' } },
  })

  it('removes excluded operations and prunes definitions, parameters and responses only they used', () => {
    const out = sanitizeSpecForPublication(swagger() as OpenAPIDocument) as Record<string, any>
    expect(Object.keys(out.paths)).toEqual(['/pub'])
    expect(Object.keys(out.definitions)).toEqual(['Pub'])
    expect(Object.keys(out.parameters)).toEqual(['Shared'])
    expect(out.responses).toEqual({})
    expect(JSON.stringify(out)).not.toMatch(/Secret|Inner/)
  })

  it('does not treat a custom root `definitions` key of an OpenAPI 3 document as prunable', () => {
    const spec = { ...swagger(), openapi: '3.1.0' } as Record<string, any>
    delete spec.swagger
    expect(Object.keys((sanitizeSpecForPublication(spec as OpenAPIDocument) as Record<string, any>).definitions)).toContain('Secret')
  })
})
