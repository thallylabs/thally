import { describe, expect, it } from 'vitest'
import { validMetatags } from '@/lib/metatags'

describe('validMetatags', () => {
  it('keeps plain string name and content pairs', () => {
    expect(validMetatags({ 'google-site-verification': 'abc', 'og:site_name': 'Docs' })).toEqual({ 'google-site-verification': 'abc', 'og:site_name': 'Docs' })
  })

  it('drops http-equiv style names, whatever the case', () => {
    expect(validMetatags({ refresh: '0;url=https://evil.test', 'Set-Cookie': 'a=b', 'http-equiv': 'refresh', 'Content-Security-Policy': "default-src 'none'", ok: 'yes' })).toEqual({ ok: 'yes' })
  })

  it('drops non-string contents, odd names, long and control-character values', () => {
    expect(validMetatags({ a: { x: 1 }, b: 2, c: null, 'bad name': 'x', 'e"': 'x', long: 'x'.repeat(1001), nl: 'a\nb', fine: 'ok' })).toEqual({ fine: 'ok' })
  })

  it('returns undefined for a value that is not an object, or when nothing is valid', () => {
    expect(validMetatags('refresh')).toBeUndefined()
    expect(validMetatags(['a'])).toBeUndefined()
    expect(validMetatags({ refresh: '1' })).toBeUndefined()
  })
})
