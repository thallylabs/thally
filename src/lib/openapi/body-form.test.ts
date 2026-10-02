import { describe, expect, it } from 'vitest'
import { activeVariant, emptyValue, encodeUrlencoded, formPairs, isFormEditable, withField } from '@/lib/openapi/body-form'

describe('body form model', () => {
  const action = {
    oneOf: [
      { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: ['wait'] }, milliseconds: { type: 'integer' } } },
      { type: 'object', required: ['type', 'selector'], properties: { type: { type: 'string', enum: ['click'] }, selector: { type: 'string' } } },
    ],
  }
  const variants = action.oneOf.map((schema) => ({ schema }))

  it('starts a new object with its required fields and defaults only', () => {
    expect(emptyValue({ type: 'object', required: ['url', 'mode'], properties: { url: { type: 'string' }, mode: { type: 'string', enum: ['fast', 'slow'] }, wait: { type: 'integer' } } })).toEqual({ url: '', mode: 'fast' })
    expect(emptyValue({ type: 'boolean', default: true })).toBe(true)
    expect(emptyValue({ type: 'array', items: { type: 'string' } })).toEqual([])
    expect(emptyValue(action)).toEqual({ type: 'wait' })
  })

  it('finds the variant a value belongs to, and switching builds that variant', () => {
    expect(activeVariant(variants, { type: 'click', selector: '#a' })).toBe(1)
    expect(activeVariant(variants, { type: 'wait' })).toBe(0)
    expect(emptyValue(variants[1].schema)).toEqual({ type: 'click', selector: '' })
  })

  it('drops an emptied optional field and keeps an emptied required one', () => {
    expect(withField({ a: 1, b: 2 }, 'a', '', false)).toEqual({ b: 2 })
    expect(withField({ a: 1 }, 'a', '', true)).toEqual({ a: '' })
    expect(withField({}, 'n', Number.NaN, false)).toEqual({})
  })

  it('encodes urlencoded bodies with repeated names and JSON for objects', () => {
    expect(formPairs({ a: 'x y', tags: ['p', 'q'], o: { k: 1 }, skip: null })).toEqual([['a', 'x y'], ['tags', 'p'], ['tags', 'q'], ['o', '{"k":1}']])
    expect(encodeUrlencoded({ a: 'x y', tags: ['p', 'q'] })).toBe('a=x+y&tags=p&tags=q')
  })

  it('edits objects and unions of objects, not bare arrays', () => {
    expect(isFormEditable({ type: 'object', properties: {} })).toBe(true)
    expect(isFormEditable(action)).toBe(true)
    expect(isFormEditable({ type: 'array', items: { type: 'string' } })).toBe(false)
  })
})
