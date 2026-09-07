/** Reader-route validation must match locale fallback and configured redirects. */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { runCheck } from '../check.js'

async function checkLinks(
  links: string,
  redirects: Array<{ source: string; destination: string }> = [],
  translation?: string,
): Promise<{ exit: number; output: string }> {
  const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-routes-'))
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
    tabs: [{ tab: 'Docs', pages: ['introduction', 'api-reference/token'] }],
    i18n: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'zh-Hans', label: 'Chinese' }] },
    redirects,
  }))
  const pages: Record<string, string> = {
    introduction: links,
    'api-reference/token': '## Response\n\nThis reference explains the complete response returned by the API.',
    ...(translation ? { 'zh-Hans/api-reference/token': translation } : {}),
  }
  for (const [path, body] of Object.entries(pages)) {
    const file = join(projectDir, `src/content/${path}.mdx`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `---\ntitle: Reference\ndescription: Complete reference documentation.\n---\n\n${body}`)
  }
  const output: Array<string> = []
  const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
  try {
    const exit = await runCheck(projectDir, { fix: false, ci: true })
    return { exit, output: output.join('\n') }
  } finally {
    log.mockRestore()
  }
}

describe('thally check reader routes', () => {
  it('accepts locale fallback and both introduction URLs', async () => {
    const result = await checkLinks('[Reference](/zh-Hans/api-reference/token#response) [Home](/introduction) [Localized home](/zh-Hans/introduction)')
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken')
  })

  it('uses actual translated anchors when a translation exists', async () => {
    const result = await checkLinks('[Reference](/zh-Hans/api-reference/token#response)', [], '## Localized heading\n\nThe translated document has a different heading.')
    expect(result.exit).toBe(0)
    expect(result.output).toContain('Broken anchor')
  })

  it('follows redirect chains and destination fragments before checking anchors', async () => {
    const result = await checkLinks('[Old reference](/old#outdated)', [
      { source: '/old', destination: '/older?source=docs' },
      { source: '/older', destination: '/api-reference/token?source=old#response' },
    ])
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken')
  })

  it('keeps missing locale targets, missing changelog content, and redirect cycles as errors', async () => {
    const result = await checkLinks('[Missing](/zh-Hans/quickstart) [Changes](/changelog) [Cycle](/loop)', [
      { source: '/loop', destination: '/other' },
      { source: '/other', destination: '/loop' },
    ])
    expect(result.exit).toBe(1)
    expect(result.output).toContain('3 error(s)')
    expect(result.output).toContain('Broken link: "/zh-Hans/quickstart"')
    expect(result.output).toContain('Broken link: "/changelog"')
    expect(result.output).toContain('Broken link: "/loop"')
  })
})
