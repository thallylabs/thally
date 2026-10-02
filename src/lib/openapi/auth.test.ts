import { describe, expect, it } from 'vitest'
import { authHeaders } from '@/lib/openapi/auth'
import type { NormalizedAuthScheme } from '@/lib/openapi/types'

const bearer: NormalizedAuthScheme = { name: 'b', kind: 'bearer', in: 'header', paramName: 'Authorization' }
const basic: NormalizedAuthScheme = { name: 'c', kind: 'basic', in: 'header', paramName: 'Authorization' }
const key: NormalizedAuthScheme = { name: 'h', kind: 'apiKey', in: 'header', paramName: 'X-Key' }
const query: NormalizedAuthScheme = { name: 'q', kind: 'apiKey', in: 'query', paramName: 'key' }

describe('authHeaders', () => {
  it('sends Bearer <token>, and nothing when the field is empty', () => {
    expect(authHeaders([bearer], { b: ' fc-123 ' })).toEqual({ Authorization: 'Bearer fc-123' })
    expect(authHeaders([bearer], {})).toEqual({})
  })
  it('shows <token> in samples only', () => {
    expect(authHeaders([bearer], {}, true)).toEqual({ Authorization: 'Bearer <token>' })
  })
  it('encodes basic user:password and passes api keys through by header name', () => {
    expect(authHeaders([basic], { c: 'a:b' })).toEqual({ Authorization: 'Basic YTpi' })
    expect(authHeaders([key], { h: 'k1' })).toEqual({ 'X-Key': 'k1' })
  })
  it('never puts a key in a URL: query schemes send nothing', () => {
    expect(authHeaders([query], { q: 'secret' })).toEqual({})
  })
})
