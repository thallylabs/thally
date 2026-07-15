import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { shouldInclude, TEMPLATE_REPOSITORY } from '../download.js'
import { resetTrackingConfig, writeTrackingConfig } from '../docs-json.js'
import {
  patchGitignore,
  patchPackageJson,
  updateSiteConfig,
  writeStarterAgentGuide,
  writeStarterContent,
  writeStarterReadme,
} from '../customize.js'

// A scaffold must NOT inherit the Thally project's own project-specific wiring.
// These guards are the safety net: if a future template change re-introduces the
// Thally project's tracking/agent config into a scaffold, one of these fails.
describe('scaffold hygiene — Track/agent are opt-in, never inherited', () => {
  describe('download filter (shouldInclude)', () => {
    it('excludes the monorepo tooling and the opt-in Track/agent wiring', () => {
      // Tarball entries look like `docs-main/<path>`.
      expect(TEMPLATE_REPOSITORY).toBe('thallylabs/docs')
      expect(shouldInclude('docs-main/.github/workflows/thally-agent.yml')).toBe(false)
      expect(shouldInclude('docs-main/packages/mcp/node_modules')).toBe(false)
      expect(shouldInclude('docs-main/packages/mcp/node_modules/zod/index.js')).toBe(false)
      expect(shouldInclude('docs-main/packages/mcp/package.json')).toBe(false)
      expect(shouldInclude('docs-main/.github/workflows/thally-track.yml')).toBe(false)
      expect(shouldInclude('docs-main/.github/CODEOWNERS')).toBe(false)
      expect(shouldInclude('docs-main/public/images/dashboard.png')).toBe(false)
      expect(shouldInclude('docs-main/src/public/image1.jpg')).toBe(false)
      expect(shouldInclude('docs-main/snippets/getting-started-tip.mdx')).toBe(false)
      expect(shouldInclude('docs-main/.github/ISSUE_TEMPLATE/bug_report.md')).toBe(false)
      expect(shouldInclude('docs-main/.github/PULL_REQUEST_TEMPLATE.md')).toBe(false)
      expect(shouldInclude('docs-main/README.md')).toBe(false)
    })

    it('still includes the platform source, docs.json, and generic CI', () => {
      // The Track/agent CODE ships (it's the platform capability, off by default);
      // only the Thally project's own config/workflows are stripped.
      expect(shouldInclude('docs-main/src/app/api/track/webhook/route.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/lib/track/github-app.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/components/admin/github-connect-panel.tsx')).toBe(true)
      expect(shouldInclude('docs-main/docs.json')).toBe(true)
      expect(shouldInclude('docs-main/.github/workflows/ci.yml')).toBe(true)
    })
  })

  describe('resetTrackingConfig', () => {
    let dir: string
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it("drops the template's tracking block but preserves the rest of docs.json", () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(
        join(dir, 'docs.json'),
        JSON.stringify({
          tabs: [{ tab: 'Docs' }],
          ai: { chat: true },
          tracking: { repos: [{ owner: 'thallylabs', repo: 'thally', branch: 'main' }] },
        }),
      )

      resetTrackingConfig(dir)

      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined() // a fresh site tracks NOTHING
      expect(result.tabs).toEqual([{ tab: 'Docs' }]) // everything else intact
      expect(result.ai).toEqual({ chat: true })
    })

    it('is a no-op when there is no tracking block (already clean)', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))
      expect(() => resetTrackingConfig(dir)).not.toThrow()
      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined()
      expect(result.tabs).toEqual([{ tab: 'Docs' }])
    })
  })

  describe('writeTrackingConfig (opt-in during setup)', () => {
    let dir: string
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('registers the chosen repos (branch main) when the user opts in', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))

      writeTrackingConfig(dir, [{ owner: 'acme', repo: 'api' }, { owner: 'acme', repo: 'web' }])

      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking.repos).toEqual([
        { owner: 'acme', repo: 'api', branch: 'main' },
        { owner: 'acme', repo: 'web', branch: 'main' },
      ])
      expect(result.tabs).toEqual([{ tab: 'Docs' }]) // rest untouched
    })

    it('writes nothing when the user opts out (empty list)', () => {
      dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
      writeFileSync(join(dir, 'docs.json'), JSON.stringify({ tabs: [{ tab: 'Docs' }] }))
      writeTrackingConfig(dir, [])
      const result = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
      expect(result.tracking).toBeUndefined()
    })
  })
})

describe('writeStarterReadme', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('replaces the canonical Thally docs README with project-owned instructions', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeStarterReadme(dir, 'Acme Docs')
    const readme = readFileSync(join(dir, 'README.md'), 'utf8')
    expect(readme).toContain('# Acme Docs')
    expect(readme).toContain('src/content/')
    expect(readme).toContain('Thally Cloud')
    expect(readme).not.toContain('# Thally\n')
  })
})

describe('writeStarterAgentGuide', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('adds project-specific instructions without inheriting Thally maintainer context', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeStarterAgentGuide(dir, 'Acme Docs')
    const guide = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(guide).toContain('# Acme Docs documentation instructions')
    expect(guide).toContain('src/content/')
    expect(guide).toContain('Content boundaries')
  })
})

describe('writeStarterContent', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('ships the canonical hero, icon navigation, and bilingual showcase', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeStarterContent(dir, 'Acme Docs', true, 'https://github.com/acme/docs')

    const config = JSON.parse(readFileSync(join(dir, 'docs.json'), 'utf8'))
    const introduction = readFileSync(join(dir, 'src/content/introduction.mdx'), 'utf8')
    const spanishIntroduction = readFileSync(join(dir, 'src/content/es/introduction.mdx'), 'utf8')

    expect(config.theme).toBe('default')
    expect(config.fonts).toBeUndefined()
    expect(config.i18n.locales).toEqual([
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' },
    ])
    expect(config.tabs[0].groups).toEqual([
      { group: 'Getting Started', icon: 'book-open', pages: ['introduction', 'quickstart'] },
      { group: 'Explore', icon: 'grid-round', pages: ['components'] },
      { group: 'Project', icon: 'wrench', pages: ['customization'] },
    ])
    expect(introduction).toContain('mode: home')
    expect(introduction).toContain('<Hero')
    expect(introduction).toContain('secondaryHref="/components"')
    expect(introduction).not.toContain('secondaryHref="/es/api"')
    expect(introduction).toContain('title="API reference" icon="code-simple" href="/api"')
    expect(introduction).toContain('<CardGroup cols={3}>')
    expect(spanishIntroduction).toContain('Te damos la bienvenida a Acme Docs')
    expect(spanishIntroduction).toContain('secondaryHref="/es/components"')
    expect(spanishIntroduction).toContain('title="Referencia de API" icon="code-simple" href="/es/api"')
  })
})

describe('updateSiteConfig', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('omits repository links until a repository URL exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    const dataDir = join(dir, 'src', 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(
      join(dataDir, 'site.ts'),
      `const brandPreset: BrandPresetKey = 'primary'\nexport const siteConfig = {\n  name: 'Thally',\n  description:\n    'Docs',\n  repoUrl: 'https://github.com/thallylabs/docs',\n  links: [\n    { label: 'Get started', href: '/quickstart' },\n    { label: 'Support', href: 'https://github.com/thallylabs/docs/issues/new' },\n    { label: 'GitHub', href: 'https://github.com/thallylabs/docs' },\n  ],\n}\n`,
    )

    updateSiteConfig(dir, 'Acme Docs', 'Acme documentation.', 'primary', '')

    const source = readFileSync(join(dataDir, 'site.ts'), 'utf8')
    expect(source).not.toContain("label: 'Support'")
    expect(source).not.toContain("label: 'GitHub'")
    expect(source).toContain("label: 'Get started'")
  })
})

// Canonical docs is standalone, but retain the older monorepo cleanup as a
// compatibility guard for local tarballs and older published CLI versions.
describe('patchPackageJson — standalone scaffolds must not inherit monorepo wiring', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  function writeTemplatePkg(dir: string) {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'thally',
        version: '0.1.0',
        workspaces: ['packages/*'],
        scripts: {
          dev: 'node scripts/run-next.mjs dev',
          prebuild: 'npm run packages:build && npm run embeddings:build',
          build: 'next build',
          'embeddings:build': 'tsx scripts/build-embeddings.ts',
          pretest: 'npm run packages:build',
          test: 'vitest run',
          'packages:build': 'npm run build -w packages/core',
        },
        dependencies: { '@thallylabs/core': '^0.1.0' },
      }),
    )
  }

  it('strips workspaces + package builds, keeps embeddings prebuild, renames to the site slug', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeTemplatePkg(dir)
    writeFileSync(join(dir, 'package-lock.json'), '{"name":"thally","lockfileVersion":3}')

    patchPackageJson(dir, 'acme-docs')

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('acme-docs')
    expect(pkg.workspaces).toBeUndefined()
    expect(pkg.scripts.prebuild).toBe('npm run embeddings:build')
    expect(pkg.scripts.pretest).toBeUndefined()
    expect(pkg.scripts['packages:build']).toBeUndefined()
    // Untouched: the scripts a site actually runs, and registry-resolvable deps.
    expect(pkg.scripts.build).toBe('next build')
    expect(pkg.scripts.dev).toBe('node scripts/run-next.mjs dev')
    expect(pkg.dependencies['@thallylabs/core']).toBe('^0.1.0')
    // The monorepo lockfile must not survive — the scaffold's own npm install
    // writes a clean one that resolves workspace deps from the registry.
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
  })

  it('preserves the canonical standalone lockfile and renames its root package', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'thally',
        scripts: { prebuild: 'npm run embeddings:build', build: 'next build' },
      }),
    )
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'thally',
        lockfileVersion: 3,
        packages: { '': { name: 'thally', version: '0.1.0' } },
      }),
    )

    patchPackageJson(dir, 'acme-docs')

    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
    expect(lock.name).toBe('acme-docs')
    expect(lock.packages[''].name).toBe('acme-docs')
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(true)
  })

  it('drops a stale canonical lockfile that still contains workspace packages', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'thally',
        dependencies: { '@thallylabs/mcp': '*' },
        scripts: { prebuild: 'npm run embeddings:build', build: 'next build' },
      }),
    )
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'thally',
        lockfileVersion: 3,
        packages: {
          '': { name: 'thally' },
          'node_modules/@thallylabs/mcp': { resolved: 'packages/mcp', link: true },
          'packages/mcp': { name: '@thallylabs/mcp', version: '0.7.0' },
        },
      }),
    )

    patchPackageJson(dir, 'acme-docs')

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@thallylabs/mcp']).toBe('0.7.0')
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
  })
})

describe('patchGitignore', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('ignores node_modules folders at every depth without duplicating the rule', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeFileSync(join(dir, '.gitignore'), '/node_modules\n.next/\n')

    patchGitignore(dir)
    patchGitignore(dir)

    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('node_modules/\n')
    expect(gitignore.match(/^node_modules\/$/gm)).toHaveLength(1)
  })
})
