import { describe, expect, it } from 'vitest'
import { operationFrom } from '@/components/api/test-fixtures'
import { isPacked, packValue, unpackValue } from '@/lib/openapi/pack-operation'

/** Objects that refer to each other and to themselves, as a real API's resources do: expansion copies them at every entry. */
function mutuallyReferencing(count: number) {
  const schemas: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) {
    schemas[`Resource${i}`] = {
      type: 'object',
      description: `Resource ${i}`,
      properties: {
        id: { type: 'string' },
        parent: { $ref: `#/components/schemas/Resource${(i + 1) % count}` },
        children: { type: 'array', items: { $ref: `#/components/schemas/Resource${(i + 2) % count}` } },
        related: { oneOf: [{ $ref: `#/components/schemas/Resource${(i + 3) % count}` }, { $ref: `#/components/schemas/Resource${(i + 4) % count}` }] },
      },
    }
  }
  const content = { 'application/json': { schema: { $ref: '#/components/schemas/Resource0' } } }
  return operationFrom({
    openapi: '3.0.3',
    info: { title: 'T', version: '1' },
    paths: { '/things': { post: { requestBody: { content }, responses: { '200': { description: 'ok', content } } } } },
    components: { schemas },
  })
}

describe('packValue', () => {
  it('round-trips an operation, including the shapes JSON cannot carry through a reference', () => {
    const operation = mutuallyReferencing(8)
    expect(unpackValue(packValue(operation))).toEqual(operation)
  })

  it('round-trips primitives, empty containers and nested arrays', () => {
    const value = { a: [], b: {}, c: [[1, 'x', null, true], [{ d: false }]], e: 0, f: '' }
    expect(unpackValue(packValue(value))).toEqual(value)
  })

  it('treats a value shaped like a reference as data', () => {
    const value = { '#': 0, nested: { '#': 1 } }
    expect(unpackValue(packValue(value))).toEqual(value)
  })

  it('shares one entry for objects that are equal, so a repeated subtree is sent once', () => {
    const copy = () => ({ type: 'object', properties: { id: { type: 'string' } } })
    const packed = packValue({ a: copy(), b: copy(), c: [copy()] })
    // string schema, properties map, object schema, root, the list, and the root's reference.
    expect(packed.packed).toHaveLength(6)
    const back = unpackValue<{ a: object; b: object }>(packed)
    expect(back.a).toBe(back.b)
  })

  it('is recognised by isPacked and nothing else is', () => {
    expect(isPacked(packValue({}))).toBe(true)
    expect(isPacked({ specId: 'x' })).toBe(false)
    expect(isPacked(null)).toBe(false)
  })

  it('keeps the wire size of a mutually referencing schema a fraction of the expanded tree', () => {
    const operation = mutuallyReferencing(12)
    const wire = JSON.stringify(packValue(operation)).length
    // Expansion copies cyclic schemas per entry point; without packing the copies are serialized in full.
    const expanded = JSON.stringify(operation).length
    expect(expanded).toBeGreaterThan(5 * wire)
  })
})
