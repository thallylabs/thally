/** Guards the canonical template and reusable workflow inherited by MCP sites. */

import { describe, expect, it } from 'vitest'

import {
  buildStarterDocsJson,
  MCP_SCAFFOLD_RELEASE_ID,
  MCP_TEMPLATE_COMMIT_SHA,
  MCP_TEMPLATE_REPOSITORY,
  shouldIncludeMcpTemplatePath,
} from '../lib/scaffold.js'
import { STABLE_SCAFFOLD_RELEASE } from 'create-thally-docs/release'

describe('MCP site scaffold source', () => {
  it('uses the canonical docs template and retains the docs-agent receiver', () => {
    expect(MCP_TEMPLATE_REPOSITORY).toBe('thallylabs/docs')
    expect(MCP_TEMPLATE_COMMIT_SHA).toBe(STABLE_SCAFFOLD_RELEASE.source.commitSha)
    expect(MCP_SCAFFOLD_RELEASE_ID).toBe(STABLE_SCAFFOLD_RELEASE.id)
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

  it('always scaffolds English and Spanish before optional locales', () => {
    const defaults = JSON.parse(
      buildStarterDocsJson({ enableAiChat: false }),
    )
    expect(defaults.i18n).toEqual({
      defaultLocale: 'en',
      locales: [
        { code: 'en', label: 'English' },
        { code: 'es', label: 'Español' },
      ],
    })

    const extended = JSON.parse(
      buildStarterDocsJson({
        enableAiChat: false,
        i18nLocales: [
          { code: 'es', label: 'Duplicate' },
          { code: 'fr', label: 'Français' },
        ],
      }),
    )
    expect(extended.i18n.locales).toEqual([
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' },
      { code: 'fr', label: 'Français' },
    ])
  })
})
