/** Regression coverage for internal links outside plain `href` attributes (#337). */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCheck, type LintIssue } from '../check.js'

function project(files: Record<string, string>): string {
  const projectDir = mkdtempSync(join(tmpdir(), 'thally-check-links-'))
  writeFileSync(join(projectDir, 'docs.json'), JSON.stringify({
    tabs: [{ tab: 'Docs', groups: [{ group: 'Start', pages: ['introduction', 'quickstart'] }] }],
  }))
  const page = (title: string, body: string) => ['---', `title: ${title}`, `description: ${title} page.`, '---', '', body, ''].join('\n')
  const defaults: Record<string, string> = {
    'src/content/introduction.mdx': page('Introduction', 'Welcome to the docs. Read the [quickstart](/quickstart) next to get going.'),
    'src/content/quickstart.mdx': page('Quickstart', 'Install the CLI, create a site and run it locally in a few minutes.'),
  }
  for (const [file, content] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(join(projectDir, file, '..'), { recursive: true })
    writeFileSync(join(projectDir, file), content)
  }
  return projectDir
}

async function brokenLinks(projectDir: string): Promise<Array<LintIssue>> {
  let issues: Array<LintIssue> = []
  await runCheck(projectDir, { fix: false, ci: true, silent: true, onIssues: (found) => { issues = found } })
  return issues.filter((issue) => issue.message.startsWith('Broken link'))
}

const intro = (body: string) => ['---', 'title: Introduction', 'description: Introduction page.', '---', '', body, ''].join('\n')

describe('thally check links in component props and site config', () => {
  it('reports a removed page linked from a prop named like href', async () => {
    const issues = await brokenLinks(project({
      'src/content/introduction.mdx': intro([
        'Welcome to the docs, start with the quickstart below.',
        '',
        '<Hero title="Docs" href="/quickstart" secondaryHref="/guides/create-a-site" />',
      ].join('\n')),
    }))
    expect(issues).toEqual([expect.objectContaining({
      severity: 'error',
      file: 'src/content/introduction.mdx',
      line: 8,
      message: expect.stringContaining('"/guides/create-a-site"'),
    })])
  })

  it('reads string expressions in link props', async () => {
    const issues = await brokenLinks(project({
      'src/content/introduction.mdx': intro([
        'Welcome to the docs, start with the quickstart below.',
        '',
        "<Card title=\"Gone\" href={'/removed'} />",
        '<Card title="Also gone" href={"/also-removed"} />',
      ].join('\n')),
    }))
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringContaining('"/removed"'),
      expect.stringContaining('"/also-removed"'),
    ])
  })

  it('still finds Markdown links inside components', async () => {
    const issues = await brokenLinks(project({
      'src/content/introduction.mdx': intro([
        'Welcome to the docs, start with the quickstart below.',
        '',
        '<Note>',
        '  Keep the [Upgrade guide](/guides/upgrade) when you remove starter pages.',
        '</Note>',
      ].join('\n')),
    }))
    expect(issues.map((issue) => issue.message)).toEqual([expect.stringContaining('"/guides/upgrade"')])
  })

  it('does not treat hreflang as a link', async () => {
    const issues = await brokenLinks(project({
      'src/content/introduction.mdx': intro('Welcome to the docs. <a href="/quickstart" hreflang="en">Quickstart</a> comes next.'),
    }))
    expect(issues).toEqual([])
  })

  it('reports a removed page linked from src/data/site.ts', async () => {
    const issues = await brokenLinks(project({
      'src/data/site.ts': [
        "export const siteConfig = {",
        "  name: 'Docs',",
        "  // { label: 'Old', href: '/commented-out' },",
        "  /* { label: 'Older', href: '/also-commented-out' } */",
        '  footer: {',
        '    links: [',
        "      { label: 'Get started', href: '/quickstart' },",
        "      { label: 'GitHub', href: 'https://github.com/thallylabs/thally' },",
        "      { label: 'Top', href: '#top' },",
        "      { label: 'Changelog', href: '/changelog' },",
        '    ],',
        '  },',
        '}',
      ].join('\n'),
    }))
    expect(issues).toEqual([expect.objectContaining({
      severity: 'error',
      file: 'src/data/site.ts',
      line: 10,
      message: expect.stringContaining('"/changelog"'),
    })])
  })

  it('accepts site config links to pages that exist', async () => {
    const issues = await brokenLinks(project({
      'src/data/site.ts': "export const siteConfig = { navbar: { links: [{ label: 'Start', href: \"/quickstart\" }] } }\n",
    }))
    expect(issues).toEqual([])
  })
})
