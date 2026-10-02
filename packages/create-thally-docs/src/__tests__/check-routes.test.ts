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
  it('does not label a deliberately hidden page as an orphan', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-hidden-'))
    mkdirSync(join(projectDir, 'src', 'content'), { recursive: true })
    writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs', pages: ['introduction'] }] }))
    writeFileSync(join(projectDir, 'src', 'content', 'introduction.mdx'), '---\ntitle: Intro\ndescription: Introduction page.\n---\n\nIntroduction content.')
    writeFileSync(join(projectDir, 'src', 'content', 'archived.mdx'), '---\ntitle: Archived\ndescription: Archived page.\nhidden: true\n---\n\nArchived content.')
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      expect(await runCheck(projectDir, { fix: false, ci: true })).toBe(0)
      expect(output.join('\n')).not.toContain('orphan')
    } finally {
      log.mockRestore()
    }
  })
  it('accepts locale fallback and both introduction URLs', async () => {
    const result = await checkLinks('[Reference](/zh-Hans/api-reference/token#response) [Home](/introduction) [Localized home](/zh-Hans/introduction)')
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken')
  })

  it('recognizes indented headings and explicit id attributes as real anchors', async () => {
    const result = await checkLinks([
      '<Tab title="Setup">',
      '  ## Install the CLI',
      '',
      '  Follow these steps.',
      '</Tab>',
      '',
      '<div id="explicit-target">Custom anchor</div>',
      '',
      '[Indented heading](#install-the-cli) [Explicit id](#explicit-target)',
    ].join('\n'))
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken anchor')
  })

  it('matches encoded fragments to explicit IDs', async () => {
    const result = await checkLinks('<a id="section-$ref"></a>\n\n[Settings](#section-%24ref)')
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken anchor')
  })

  it('accepts legacy named anchors in imported notebook pages', async () => {
    const result = await checkLinks('<a name="subscribe"></a>\n\n[Subscribe](#subscribe)')
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken anchor')
  })

  it('resolves a link to the id a heading carries in a trailing {/* #id */} comment', async () => {
    const result = await checkLinks([
      '## Primeros pasos {/* #get-started */}',
      '## Scrape + Interact {/* #scrape-+-interact */}',
      '[Start](#get-started) [Plus](#scrape-+-interact) [Slug](#primeros-pasos)',
    ].join('\n'))
    expect(result.output).not.toContain('"#get-started"')
    expect(result.output).not.toContain('"#scrape-+-interact"')
    expect(result.output).toContain('"#primeros-pasos"')
  })

  it('uses visible text for headings containing JSX badges and anchors', async () => {
    const result = await checkLinks([
      '## Initialize instance <Badge title="1 > 0">Enterprise</Badge>',
      '### CLI <a id="-cli" />',
      '[Enterprise](#initialize-instance-enterprise) [CLI](#cli)',
    ].join('\n'))
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken anchor')
  })

  it('accepts the second occurrence of a repeated heading', async () => {
    const result = await checkLinks('## Key Features\n\nFirst.\n\n## Key Features\n\nSecond.\n\n[Second](#key-features-2)')
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken anchor')
  })

  it('ignores links, images, and headings inside nested code fences', async () => {
    const result = await checkLinks([
      '````mdx',
      '```tsx',
      '<a href="/missing">Example</a>',
      '<img src="/missing.png" />',
      '### code-only-heading',
      '```',
      '````',
      '',
      '[Real link](/api-reference/token#response)',
      '[Not a real heading](#code-only-heading)',
    ].join('\n'))
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken link: "/missing"')
    expect(result.output).not.toContain('Broken image')
    expect(result.output).toContain('Broken anchor: "#code-only-heading"')
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

  it('resolves a link through a Next.js-style wildcard/param redirect source the same way the runtime matches it', async () => {
    const result = await checkLinks('[Old reference](/old/api-reference/token)', [
      { source: '/old/:slug*', destination: '/:slug*' },
    ])
    expect(result.exit).toBe(0)
    expect(result.output).not.toContain('Broken')
  })

  it('still reports a broken link when a wildcard/param redirect resolves to a page that does not exist', async () => {
    const result = await checkLinks('[Missing](/old/nowhere)', [
      { source: '/old/:slug*', destination: '/:slug*' },
    ])
    expect(result.exit).toBe(1)
    expect(result.output).toContain('Broken link: "/old/nowhere"')
  })

  it('terminates on a wildcard redirect whose destination keeps matching its own source', async () => {
    const result = await checkLinks('[Docs](/docs/intro)', [
      { source: '/docs/:slug*', destination: '/docs/v2/:slug*' },
    ])
    expect(result.exit).toBe(1)
  })

  it('matches a trailing :param* with zero segments, like Next.js', async () => {
    const result = await checkLinks('[Old](/old)', [
      { source: '/old/:slug*', destination: '/introduction/:slug*' },
    ])
    expect(result.exit).toBe(0)
  })

  it('substitutes params by exact name when one name prefixes another', async () => {
    const result = await checkLinks('[Old](/x/1/token)', [
      { source: '/x/:a/:abc', destination: '/api-reference/:abc' },
    ])
    expect(result.exit).toBe(0)
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
