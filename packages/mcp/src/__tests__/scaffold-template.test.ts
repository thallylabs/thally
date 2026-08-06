/** Guards MCP's intentionally thin delegation to create-thally-docs. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MCP_SCAFFOLD_RELEASE_ID,
  MCP_STARTER_COMMIT_SHA,
  MCP_STARTER_REPOSITORY,
} from '../lib/scaffold.js'
import { STABLE_SCAFFOLD_RELEASE } from 'create-thally-docs/release'

describe('MCP site scaffold source', () => {
  it('identifies the exact dedicated starter release', () => {
    expect(MCP_STARTER_REPOSITORY).toBe('thallylabs/starter')
    expect(MCP_STARTER_COMMIT_SHA).toBe(
      STABLE_SCAFFOLD_RELEASE.source.commitSha,
    )
    expect(MCP_SCAFFOLD_RELEASE_ID).toBe(STABLE_SCAFFOLD_RELEASE.id)
  })

  it('delegates without carrying archive or personalization policy', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../lib/scaffold.ts', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('return scaffoldProject(options)')
    expect(source).not.toContain("from 'tar'")
    expect(source).not.toContain('fetch(')
    expect(source).not.toContain('buildStarterDocsJson')
    expect(source).not.toContain('EXCLUDE_PATHS')
  })
})
