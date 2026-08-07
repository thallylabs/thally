import { describe, expect, it } from 'vitest'
import { displaySiteName } from './use-site-name'

describe('displaySiteName', () => {
  it('capitalizes a lowercase site name for brand surfaces', () => {
    expect(displaySiteName('sina')).toBe('Sina')
  })

  it('leaves already-capitalized and mixed-case names alone past the first letter', () => {
    expect(displaySiteName('Acme API')).toBe('Acme API')
    expect(displaySiteName('iPhone Docs')).toBe('IPhone Docs')
  })

  it('trims whitespace and tolerates empty names', () => {
    expect(displaySiteName('  sina ')).toBe('Sina')
    expect(displaySiteName('')).toBe('')
    expect(displaySiteName('   ')).toBe('')
  })
})
