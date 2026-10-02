import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BodyForm } from '@/components/api/body-form'
import { buildCodeSamples } from '@/lib/openapi/code-samples'

const schema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri' },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    timeout: { type: 'integer', default: 30000 },
    onlyMainContent: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    options: { type: 'object', properties: { depth: { type: 'integer' } } },
    action: { oneOf: [{ title: 'Wait', type: 'object', properties: { type: { type: 'string', enum: ['wait'] } } }, { title: 'Click', type: 'object', properties: { type: { type: 'string', enum: ['click'] } } }] },
    avatar: { type: 'string', format: 'binary' },
  },
}
const html = renderToStaticMarkup(<BodyForm schema={schema} value={{ url: 'https://a.dev', tags: ['x'] }} onChange={() => {}} onFile={() => {}} />)

describe('BodyForm', () => {
  it('marks required fields and keeps the optional ones behind an expander', () => {
    expect(html).toContain('required')
    expect(html).toMatch(/Show 7 optional fields/)
  })
  it('uses typed inputs: select for enums and booleans, number for integers, file for binary', () => {
    expect(html).toMatch(/<select[^>]*aria-label="mode"/)
    expect(html).toMatch(/<select[^>]*aria-label="onlyMainContent"/)
    expect(html).toMatch(/<input[^>]*type="number"[^>]*/)
    expect(html).toMatch(/type="file"/)
  })
  it('shows a default as the placeholder, array add/remove, and a variant picker', () => {
    expect(html).toContain('placeholder="30000"')
    expect(html).toContain('Add an item')
    expect(html).toContain('aria-label="Remove tags 1"')
    expect(html).toContain('aria-label="action variant"')
    expect(html).toContain('>Click<')
  })
})

describe('multipart sample', () => {
  it('shows only cURL, with one --form per field', () => {
    const samples = buildCodeSamples({ method: 'POST', url: 'https://a.dev/x', headers: {}, form: [['name', 'n'], ['file', '@a.png']] })
    expect(samples.map((sample) => sample.label)).toEqual(['cURL'])
    expect(samples[0].source).toContain("--form 'file=@a.png'")
  })
})
