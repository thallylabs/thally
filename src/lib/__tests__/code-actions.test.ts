/** Regression coverage for code-sample assistant and issue-report payloads. */

import { describe, expect, it } from 'vitest'

import { buildCodeReportUrl, createCodeAssistantPrompt } from '../code-actions'

describe('code-sample actions', () => {
  it('preserves the selected code in the assistant prompt', () => {
    expect(createCodeAssistantPrompt('const answer = 42')).toBe(
      'Explain this code sample and check it for mistakes:\n\n```\nconst answer = 42\n```',
    )
  })

  it('creates an issue URL with the current page and selected code', () => {
    const url = new URL(buildCodeReportUrl({
      repositoryUrl: 'https://github.com/acme/docs/',
      pageUrl: 'https://docs.acme.test/quickstart#install',
      code: 'npm install acme',
    }) ?? '')

    expect(url.href).toContain('github.com/acme/docs/issues/new?')
    expect(url.searchParams.get('title')).toBe('Docs: incorrect code sample')
    expect(url.searchParams.get('body')).toContain('Page: https://docs.acme.test/quickstart#install')
    expect(url.searchParams.get('body')).toContain('npm install acme')
  })

  it('rejects non-web repository URLs', () => {
    expect(buildCodeReportUrl({
      repositoryUrl: 'javascript:alert(1)',
      pageUrl: 'https://docs.acme.test',
      code: 'unsafe',
    })).toBeNull()
  })
})
