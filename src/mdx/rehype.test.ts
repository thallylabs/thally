/** Regression tests for code-fence metadata shared by authored and migrated docs. */

import { describe, expect, it } from 'vitest'

import { parseCodeFenceMeta } from './rehype'

describe('code-fence metadata', () => {
  it('does not display renderer presentation props as code titles', () => {
    expect(parseCodeFenceMeta('theme={"system"}')).toEqual({})
    expect(parseCodeFenceMeta('api-client.ts theme={"system"}')).toEqual({ title: 'api-client.ts' })
  })

  it('keeps explicit filenames and portable display options', () => {
    expect(parseCodeFenceMeta('filename="client.ts" wrap {2,4-5}')).toEqual({
      title: 'client.ts',
      wrap: true,
      highlight: [2, 4, 5],
    })
  })
})
