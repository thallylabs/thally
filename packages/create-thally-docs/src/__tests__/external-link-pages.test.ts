/** A migrated Mintlify page that links elsewhere passes `thally check`: it is in the navigation and its path redirects off the site. */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { migrateRepository, renderMigrationFiles } from '@thallylabs/migrate'
import { describe, expect, it, vi } from 'vitest'

import { runCheck } from '../check.js'

describe('thally check on a migrated page whose frontmatter url is another site', () => {
  it('reports no orphan, no missing page and no broken link for the page or a link to it', async () => {
    const source = mkdtempSync(join(tmpdir(), 'thally-link-page-source-'))
    writeFileSync(join(source, 'docs.json'), JSON.stringify({
      navigation: { groups: [{ group: 'Community', pages: ['introduction', 'github-repo'] }] },
    }))
    writeFileSync(join(source, 'introduction.mdx'), '---\ntitle: Introduction\ndescription: Where the project lives.\n---\n\nThe [source code](/github-repo) is public, and this page has enough prose to avoid the short body notice.')
    writeFileSync(join(source, 'github-repo.mdx'), '---\ntitle: GitHub repo\ndescription: The source code.\nurl: "https://github.com/acme/docs"\n---\n\nThe project is open source on GitHub, so anyone can read and change it.')
    const bundle = migrateRepository({ repositoryDir: source, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })

    const site = mkdtempSync(join(tmpdir(), 'thally-link-page-site-'))
    for (const file of renderMigrationFiles(bundle)) {
      mkdirSync(dirname(join(site, file.path)), { recursive: true })
      writeFileSync(join(site, file.path), file.content)
    }
    const output: Array<string> = []
    const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)))
    try {
      expect(await runCheck(site, { fix: false, ci: true })).toBe(0)
    } finally {
      log.mockRestore()
    }
    expect(output.join('\n')).not.toMatch(/orphan|no MDX file|Broken/)
  })
})

describe('thally check on the stub the migrator writes for a Mintlify url entry', () => {
  const stubWarning = /Very short body|Missing "description"/

  /** Migrate a site whose `github-repo` page is only a title and a `url`, plus an ordinary short page, and return the check issues by file. */
  async function issuesByFile(extra: Record<string, string> = {}, editSite?: (site: string) => void): Promise<Map<string, Array<string>>> {
    const source = mkdtempSync(join(tmpdir(), 'thally-link-stub-source-'))
    writeFileSync(join(source, 'docs.json'), JSON.stringify({
      navigation: { groups: [{ group: 'Community', pages: ['introduction', 'github-repo', 'short'] }] },
    }))
    writeFileSync(join(source, 'introduction.mdx'), '---\ntitle: Introduction\ndescription: Where the project lives.\n---\n\nThis page has enough prose to avoid the short body notice, and it links nowhere.')
    writeFileSync(join(source, 'github-repo.mdx'), '---\ntitle: GitHub repo\nurl: "https://github.com/acme/docs"\n---\n')
    writeFileSync(join(source, 'short.mdx'), '---\ntitle: Short\n---\n')
    for (const [file, content] of Object.entries(extra)) writeFileSync(join(source, file), content)
    const bundle = migrateRepository({ repositoryDir: source, sourceUrl: 'https://github.com/acme/docs', platform: 'mintlify' })
    const site = mkdtempSync(join(tmpdir(), 'thally-link-stub-site-'))
    for (const file of renderMigrationFiles(bundle)) {
      mkdirSync(dirname(join(site, file.path)), { recursive: true })
      writeFileSync(join(site, file.path), file.content)
    }
    editSite?.(site)
    const found: Array<{ file?: string; message: string }> = []
    await runCheck(site, { fix: false, ci: true, silent: true, onIssues: (issues) => found.push(...issues) })
    const byFile = new Map<string, Array<string>>()
    for (const issue of found) byFile.set(issue.file ?? '', [...(byFile.get(issue.file ?? '') ?? []), issue.message])
    return byFile
  }

  it('does not warn that the page has no description or body', async () => {
    const byFile = await issuesByFile()
    expect(byFile.get('src/content/github-repo.mdx') ?? []).toEqual([])
  })

  it('does not warn when the stub redirects to a path on the site instead of another site', async () => {
    // What a root-relative `url:` (`/introduction#login`) becomes: the same never-rendered stub, redirecting within the site.
    const byFile = await issuesByFile({}, (site) => {
      writeFileSync(join(site, 'src/content/github-repo.mdx'), '---\ntitle: GitHub repo\nnoindex: true\n---\n')
      const config = JSON.parse(readFileSync(join(site, 'docs.json'), 'utf8')) as { redirects?: Array<{ source: string }> }
      config.redirects = [...(config.redirects ?? []).filter((redirect) => redirect.source !== '/github-repo'),
        { source: '/github-repo', destination: '/introduction#login' } as { source: string }]
      writeFileSync(join(site, 'docs.json'), JSON.stringify(config))
    })
    expect((byFile.get('src/content/github-repo.mdx') ?? []).filter((message) => stubWarning.test(message))).toEqual([])
  })

  it('still warns about an ordinary short page next to it', async () => {
    const byFile = await issuesByFile()
    expect((byFile.get('src/content/short.mdx') ?? []).filter((message) => stubWarning.test(message))).toHaveLength(2)
  })

  it('still warns about a short page that is noindex but redirects nowhere', async () => {
    const byFile = await issuesByFile({ 'short.mdx': '---\ntitle: Short\nnoindex: true\n---\n' })
    expect((byFile.get('src/content/short.mdx') ?? []).filter((message) => stubWarning.test(message))).toHaveLength(2)
  })
})
