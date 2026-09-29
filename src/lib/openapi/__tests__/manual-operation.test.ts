import { describe, expect, it, vi } from 'vitest'
import {
  buildManualBody,
  buildManualOperation,
  extractParamFields,
  parseApiFrontmatter,
  sanitizeApiMdxConfig,
} from '@/lib/openapi/manual-operation'

const noConfig = { servers: [] as Array<string> }

describe('parseApiFrontmatter', () => {
  it('parses absolute URLs, paths, lowercase methods, whitespace and quotes', () => {
    expect(parseApiFrontmatter('POST https://api.example.com/users')).toEqual({ method: 'POST', server: 'https://api.example.com', path: '/users', query: {} })
    expect(parseApiFrontmatter('get /status')).toEqual({ method: 'GET', path: '/status', query: {} })
    expect(parseApiFrontmatter('\tGET \t /status  ')).toMatchObject({ method: 'GET', path: '/status' })
    expect(parseApiFrontmatter('"GET /status"')).toMatchObject({ path: '/status' })
    expect(parseApiFrontmatter("'DELETE https://x.io/a/{id}/'")).toMatchObject({ server: 'https://x.io', path: '/a/{id}/' })
  })

  it('keeps path params, trailing slash and splits the query string', () => {
    expect(parseApiFrontmatter('GET https://api.example.com/v1/users/{userId}?expand=1&x=a%20b#frag')).toEqual({
      method: 'GET', server: 'https://api.example.com', path: '/v1/users/{userId}', query: { expand: '1', x: 'a b' },
    })
    expect(parseApiFrontmatter('GET https://api.example.com')).toMatchObject({ path: '/' })
  })

  it.each([
    ['FETCH /x'],
    ['GET'],
    ['/x'],
    ['GET users'],
    ['GET javascript:alert(1)'],
    ['GET ftp://x.com/a'],
    ['GET https://user:pw@x.com/a'],
    ['GET https:///a'],
    ['GET /a b'],
    [''],
  ])('rejects %j with a warning', (value) => {
    const warn = vi.fn()
    expect(parseApiFrontmatter(value, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it.each([[42], [['GET /x']], [{ a: 1 }], [null], [true]])('rejects non-string %j', (value) => {
    const warn = vi.fn()
    expect(parseApiFrontmatter(value, warn)).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('sanitizeApiMdxConfig', () => {
  it('accepts a string or array of servers and strips trailing slashes', () => {
    expect(sanitizeApiMdxConfig({ server: 'https://a.com/' }).servers).toEqual(['https://a.com'])
    expect(sanitizeApiMdxConfig({ server: ['https://a.com/v1', 'https://b.com', 'https://a.com/v1/'] }).servers).toEqual(['https://a.com/v1', 'https://b.com'])
  })

  it('drops invalid servers with warnings', () => {
    const warn = vi.fn()
    const result = sanitizeApiMdxConfig({ server: ['javascript:alert(1)', 'not a url', '/relative', 'https://u:p@a.com', 'http://ok.com', 5, 'https://a.com?x=1'] }, warn)
    expect(result.servers).toEqual(['http://ok.com'])
    expect(warn).toHaveBeenCalledTimes(6)
  })

  it('validates auth', () => {
    expect(sanitizeApiMdxConfig({ auth: { method: 'bearer' } }).auth).toEqual({ method: 'bearer' })
    expect(sanitizeApiMdxConfig({ auth: { method: 'key', name: 'x-api-key' } }).auth).toEqual({ method: 'key', name: 'x-api-key' })
    const warn = vi.fn()
    expect(sanitizeApiMdxConfig({ auth: { method: 'key' } }, warn).auth).toBeUndefined()
    expect(sanitizeApiMdxConfig({ auth: { method: 'oauth' } }, warn).auth).toBeUndefined()
    expect(sanitizeApiMdxConfig({ auth: 'bearer' }, warn).auth).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(sanitizeApiMdxConfig({ auth: {} }).auth).toBeUndefined()
  })

  it('tolerates a malformed api.mdx', () => {
    for (const raw of ['x', 5, [1], null, undefined]) {
      expect(sanitizeApiMdxConfig(raw).servers).toEqual([])
    }
  })
})

describe('extractParamFields', () => {
  it('reads located names, name attribute, type, required, default and expression values', () => {
    const fields = extractParamFields(`
<ParamField path="id" type="string" required default="123">x</ParamField>
<ParamField query="verbose" type="boolean" default={true} />
<ParamField header="X-Trace" placeholder="abc" />
<ParamField body="user.name" type="string" required />
<ParamField body name="age" type="integer" default={5} />
<ParamField name="plain" type="string" />
`)
    expect(fields).toEqual([
      { location: 'path', name: 'id', type: 'string', required: true, default: '123' },
      { location: 'query', name: 'verbose', type: 'boolean', required: false, default: 'true' },
      { location: 'header', name: 'X-Trace', required: false, placeholder: 'abc' },
      { location: 'body', name: 'user.name', type: 'string', required: true },
      { location: 'body', name: 'age', type: 'integer', required: false, default: '5' },
      { location: 'body', name: 'plain', type: 'string', required: false },
    ])
  })

  it('skips nameless and duplicate fields with warnings, and survives broken MDX', () => {
    const warn = vi.fn()
    const fields = extractParamFields('<ParamField type="string" />\n<ParamField query="a" />\n<ParamField query="a" default="2" />', warn)
    expect(fields).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(2)
    const warnBroken = vi.fn()
    expect(extractParamFields('<ParamField query="a"', warnBroken)).toEqual([])
    expect(warnBroken).toHaveBeenCalled()
  })

  it('finds ParamFields nested in other components', () => {
    expect(extractParamFields('<Panel>\n<ParamField query="q" />\n</Panel>')).toHaveLength(1)
  })
})

describe('buildManualBody', () => {
  it('builds flat and nested JSON with typed defaults', () => {
    const body = buildManualBody(extractParamFields(`
<ParamField body="name" type="string" default="Ann" />
<ParamField body="age" type="integer" />
<ParamField body="ok" type="boolean" />
<ParamField body="tags" type="string[]" />
<ParamField body="user.email" type="string" />
<ParamField body="user.address.city" type="string" default="X" />
`))
    expect(JSON.parse(body!)).toEqual({ name: 'Ann', age: 0, ok: false, tags: [], user: { email: '', address: { city: 'X' } } })
  })

  it('is undefined without body fields and safe against prototype keys', () => {
    expect(buildManualBody([])).toBeUndefined()
    const body = buildManualBody([{ location: 'body', name: '__proto__.x', required: false }, { location: 'body', name: 'a', required: false }])
    expect(JSON.parse(body!)).toEqual({ a: '' })
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

describe('buildManualOperation', () => {
  const mdx = `
<ParamField path="id" type="string" required default="42" />
<ParamField query="verbose" type="boolean" />
<ParamField header="X-Trace" type="string" />
<ParamField body="name" type="string" />
<ParamField body="age" type="integer" />
`
  function build(overrides: Record<string, unknown> = {}) {
    return buildManualOperation({ pageId: 'p/users', title: 'Users', api: 'POST https://httpbin.org/anything/users/{id}', mdx, config: noConfig, ...overrides })
  }

  it('builds a full operation from an absolute URL', () => {
    const op = build()!
    expect(op).toMatchObject({ method: 'POST', path: '/anything/users/{id}', servers: [{ url: 'https://httpbin.org' }], manualPage: 'p/users', isWebhook: false })
    expect(op.prefill.path).toEqual({ id: '42' })
    expect(op.prefill.query).toEqual({ verbose: '' })
    expect(op.prefill.header).toEqual({ 'X-Trace': '' })
    expect(JSON.parse(op.prefill.body!)).toEqual({ name: '', age: 0 })
    expect(op.parameters.path[0]).toMatchObject({ name: 'id', required: true })
  })

  it('uses docs.json servers and auth for path-only values; absolute URL wins', () => {
    const config = { servers: ['https://httpbin.org', 'https://b.example.com'], auth: { method: 'bearer' as const } }
    const op = build({ api: 'GET /status', mdx: '', config })!
    expect(op.servers.map((s) => s.url)).toEqual(['https://httpbin.org', 'https://b.example.com'])
    expect(op.prefill.header).toEqual({ Authorization: 'Bearer YOUR_TOKEN' })
    expect(build({ api: 'GET https://x.com/a', mdx: '', config })!.servers).toEqual([{ url: 'https://x.com' }])
  })

  it('warns and has no servers for a path with no configured server', () => {
    const warn = vi.fn()
    const op = build({ api: 'GET /status', mdx: '', warn })!
    expect(op.servers).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('playground is disabled'))
  })

  it('maps authMethod overrides', () => {
    const config = { servers: [], auth: { method: 'bearer' as const } }
    expect(build({ authMethod: 'none', config })!.prefill.header).toEqual({ 'X-Trace': '' })
    expect(build({ authMethod: 'basic', config })!.prefill.header.Authorization).toMatch(/^Basic /)
    const warn = vi.fn()
    expect(build({ authMethod: 'key', config, warn })!.prefill.header.Authorization).toBeUndefined()
    expect(build({ authMethod: 'wat', config, warn })!.prefill.header.Authorization).toMatch(/^Bearer /)
    expect(build({ config: { servers: [], auth: { method: 'key' as const, name: 'x-api-key' } } })!.prefill.header['x-api-key']).toBe('YOUR_API_KEY')
  })

  it('prefills query from the URL and warns about path fields missing in the URL', () => {
    const warn = vi.fn()
    const op = build({ api: 'GET https://x.com/a?limit=5', mdx: '<ParamField path="nope" />', warn })!
    expect(op.prefill.query).toEqual({ limit: '5' })
    expect(op.prefill.path).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope'))
  })

  it('returns null for unusable api values', () => {
    for (const api of ['FETCH /x', 'GET', 5, ['GET /x'], { a: 1 }, undefined]) {
      expect(build({ api })).toBeNull()
    }
  })
})
