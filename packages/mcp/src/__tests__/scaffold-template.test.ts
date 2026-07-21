/** Guards the canonical template and reusable workflow inherited by MCP sites. */

import { describe, expect, it } from 'vitest'

import {
  MCP_TEMPLATE_REPOSITORY,
  shouldIncludeMcpTemplatePath,
} from '../lib/scaffold.js'

describe('MCP site scaffold source', () => {
  it('uses the canonical docs template and retains the docs-agent receiver', () => {
    expect(MCP_TEMPLATE_REPOSITORY).toBe('thallylabs/docs')
    expect(
      shouldIncludeMcpTemplatePath('docs-main/.github/workflows/thally-agent.yml'),
    ).toBe(true)
  })

  it('continues to exclude project-specific Track and administration files', () => {
    expect(
      shouldIncludeMcpTemplatePath('docs-main/.github/workflows/thally-track.yml'),
    ).toBe(false)
    expect(shouldIncludeMcpTemplatePath('docs-main/.github/CODEOWNERS')).toBe(false)
    expect(shouldIncludeMcpTemplatePath('docs-main/packages/mcp/package.json')).toBe(false)
  })
})
