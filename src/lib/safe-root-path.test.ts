/** Contract for the root-path check shared by the rich-content link and source guards. */

import { describe, expect, it } from 'vitest'
import { isSafeRootPath } from './safe-root-path'

describe('isSafeRootPath', () => {
  it.each(['/', '/docs', '/docs/guide?tab=1#intro', '/images/a b.png', '/%2F%2Fevil.example'])('accepts %j', (value) => {
    expect(isSafeRootPath(value)).toBe(true)
  })

  it.each([
    '',
    'docs',
    '#top',
    'https://example.com',
    '//evil.example',
    '/\\evil.example',
    '/a\\b',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    '/\u0000/evil.example',
    '/\u001f/evil.example',
    '/\u007f/evil.example',
    '/ok\t',
  ])('rejects %j', (value) => {
    expect(isSafeRootPath(value)).toBe(false)
  })
})
