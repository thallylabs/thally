/** Verify the narrow repository and tracking entries match the public barrel. */

import { describe, expect, it } from 'vitest'
import * as core from '@thallylabs/core'
import * as repository from '@thallylabs/core/repository'
import * as tracking from '@thallylabs/core/tracking'

describe('@thallylabs/core/repository and /tracking', () => {
  it('exposes the same functions as the root export', () => {
    for (const [name, value] of Object.entries(repository)) {
      expect(core[name as keyof typeof core]).toBe(value)
    }
    for (const [name, value] of Object.entries(tracking)) {
      expect(core[name as keyof typeof core]).toBe(value)
    }
  })

  it('parses through the subpath entry', () => {
    expect(repository.parseRepositoryReference('gitlab.com/g/s/p')?.fullPath).toBe('g/s/p')
  })
})
