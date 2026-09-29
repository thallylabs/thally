/** Portable appearance fallbacks, URL boundaries, and the prepaint locked theme contract. */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { lockedAppearanceScript, resolveBackgroundImage, resolveSiteAppearance, resolveSiteBackground } from '../site-appearance'

describe('reader appearance', () => {
  it.each(['</script><script>alert(1)</script>', "';alert(1);//", 'unknown'])('never interpolates an unexpected mode: %s', mode => {
    const script = lockedAppearanceScript(mode as Parameters<typeof lockedAppearanceScript>[0])
    expect(script).toBe(lockedAppearanceScript('system'))
    expect(script).not.toContain(mode)
  })
  it('preserves system mode and reader controls by default', () => {
    expect(resolveSiteAppearance()).toEqual({ default: 'system', showToggle: true })
  })
  it('merges managed overrides per field and preserves explicit false', () => {
    expect(resolveSiteAppearance({ default: 'dark', showToggle: true }, { showToggle: false })).toEqual({ default: 'dark', showToggle: false })
    expect(resolveSiteAppearance({ showToggle: false }, { default: 'light' })).toEqual({ default: 'light', showToggle: false })
  })
  it.each(['light', 'dark', 'system'] as const)('enforces %s before paint regardless of a previous reader choice', (mode) => {
    for (const isDark of [true, false]) {
      const classes = new Set(['light', 'font-body'])
      const documentElement = { classList: { remove: (...names: string[]) => names.forEach(name => classes.delete(name)), add: (name: string) => classes.add(name) }, style: { colorScheme: '' } }
      runInNewContext(lockedAppearanceScript(mode), { document: { documentElement }, matchMedia: () => ({ matches: isDark }), localStorage: { getItem: () => { throw new Error('Locked themes must not read storage') } } })
      const expected = mode === 'system' ? isDark ? 'dark' : 'light' : mode
      expect(classes).toEqual(new Set(['font-body', expected]))
      expect(documentElement.style.colorScheme).toBe(expected)
    }
  })
})

describe('background image boundary', () => {
  it.each(['public/brand/background-light.png', '/public/brand/background-light.png', '/brand/background-light.png', 'brand/background-light.png'])('normalizes %s to a public browser path', value => {
    expect(resolveBackgroundImage(value)).toBe('/brand/background-light.png')
  })
  it('accepts HTTPS CDN image endpoints without fetching or requiring an extension', () => {
    expect(resolveBackgroundImage('https://cdn.example.com/image?id=12&width=800')).toBe('https://cdn.example.com/image?id=12&width=800')
  })
  it.each(['//cdn.example.com/a.png', '../a.png', 'public/../a.png', 'public//a.png', '/a.svg', 'javascript:alert(1)', 'data:image/png;base64,a', 'http://cdn.example.com/a.png', 'https://user:pass@cdn.example.com/a.png', 'https://cdn.example.com/a.png\n', 'https://cdn.example.com/\";color:red', 'https://cdn.example.com/</style>', 'https://cdn.example.com/a\\b', '/a%2e%2e.png'])('rejects unsafe image %s', value => {
    expect(resolveBackgroundImage(value)).toBeNull()
  })
  it('merges per field and permits explicit image removal', () => {
    expect(resolveSiteBackground({ image: '/a.png', decoration: 'grid' }, { imageDark: '/b.webp' })).toEqual({ image: '/a.png', imageDark: '/b.webp', decoration: 'grid' })
    expect(resolveSiteBackground({ image: '/a.png', decoration: 'grid' }, { image: '', decoration: 'none' })).toEqual({ decoration: 'none' })
  })
})
