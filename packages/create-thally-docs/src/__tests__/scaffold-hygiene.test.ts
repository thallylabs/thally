import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { shouldInclude, TEMPLATE_COMMIT_SHA, TEMPLATE_REPOSITORY } from '../download.js'
import { STABLE_SCAFFOLD_RELEASE, isStableScaffoldRelease } from '../release.js'
import { resetTrackingConfig, writeTrackingConfig } from '../docs-json.js'
import {
  MIN_CLI_VERSION,
  MIN_MCP_VERSION,
  buildStarterFiles,
  patchGitignore,
  patchPackageJson,
  raisePinToFloor,
  updateSiteConfig,
  writeCloudflareRuntimeConfig,
  writeStarterAgentGuide,
  writeStarterContent,
  writeStarterReadme,
} from '../customize.js'

// A scaffold inherits the reusable docs-agent receiver, but never Thally's own
// project-specific Track senders or repository administration files.
describe('scaffold hygiene — agent-ready by default, Track senders remain opt-in', () => {
  describe('download filter (shouldInclude)', () => {
    it('excludes monorepo tooling and project-specific Track wiring', () => {
      // Tarball entries look like `docs-main/<path>`.
      expect(TEMPLATE_REPOSITORY).toBe('thallylabs/docs')
      expect(TEMPLATE_COMMIT_SHA).toBe(STABLE_SCAFFOLD_RELEASE.source.commitSha)
      expect(STABLE_SCAFFOLD_RELEASE.source.archiveUrl).toContain(TEMPLATE_COMMIT_SHA)
      expect(isStableScaffoldRelease(structuredClone(STABLE_SCAFFOLD_RELEASE))).toBe(true)
      expect(shouldInclude('docs-main/.github/workflows/thally-agent.yml')).toBe(true)
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
      expect(shouldInclude('docs-main/.env.production')).toBe(false)
    })

    it('still includes the platform source, docs.json, and generic CI', () => {
      // The receiver is inert until explicitly dispatched and its required
      // secret is configured, so it is safe to ship with every new site.
      expect(shouldInclude('docs-main/src/app/api/track/webhook/route.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/lib/track/github-app.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/components/admin/github-connect-panel.tsx')).toBe(true)
      // The visual handoff is runtime infrastructure, so every new scaffold
      // must retain it from the canonical docs repository.
      expect(shouldInclude('docs-main/src/styles/docs-handoff.css')).toBe(true)
      expect(shouldInclude('docs-main/src/components/mdx/agent-prompt.tsx')).toBe(true)
      expect(shouldInclude('docs-main/src/app/llms.txt/route.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/app/robots.txt/route.ts')).toBe(true)
      expect(shouldInclude('docs-main/src/lib/agent-manifest.ts')).toBe(true)
      expect(shouldInclude('docs-main/docs.json')).toBe(true)
      expect(shouldInclude('docs-main/.github/workflows/ci.yml')).toBe(true)
      expect(shouldInclude('docs-main/.github/workflows/thally-agent.yml')).toBe(true)
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

describe('writeCloudflareRuntimeConfig', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('writes portable OpenNext and Wrangler configuration without account secrets', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))

    writeCloudflareRuntimeConfig(dir, 'acme-docs')

    const openNext = readFileSync(join(dir, 'open-next.config.ts'), 'utf8')
    const wrangler = JSON.parse(readFileSync(join(dir, 'wrangler.jsonc'), 'utf8'))
    expect(openNext).toContain('defineCloudflareConfig')
    expect(wrangler).toMatchObject({
      name: 'acme-docs',
      main: '.open-next/worker.js',
      compatibility_date: '2026-07-15',
      observability: {
        enabled: true,
        logs: { head_sampling_rate: 1 },
        traces: { enabled: true, head_sampling_rate: 0.01 },
      },
      assets: { binding: 'ASSETS' },
    })
    expect(JSON.stringify(wrangler)).not.toContain('account_id')
    expect(JSON.stringify(wrangler)).not.toContain('api_token')
    expect(JSON.stringify(wrangler)).not.toContain('THALLY_SITE_URL')
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
    expect(config.tabs[0].tab).toBe('Get started')
    expect(config.tabs[0].groups).toEqual([
      { group: 'Start here', icon: 'book-open', pages: ['introduction', 'quickstart'] },
      { group: 'Create content', icon: 'grid-round', pages: ['components'] },
      { group: 'Customize your site', icon: 'wrench', pages: ['customization'] },
    ])
    expect(introduction).toContain('mode: home')
    expect(introduction).toContain('<Hero')
    expect(introduction).toContain('secondaryHref="/components"')
    expect(introduction).toContain('## Build your documentation')
    expect(introduction).toContain('## Publish and extend')
    expect(introduction).toContain('title="Complete the quickstart"')
    expect(introduction).not.toContain('secondaryHref="/es/api"')
    expect(introduction).toContain('title="Integrate the API" icon="code-simple" href="/api"')
    expect(introduction.match(/<CardGroup cols="2">/g)).toHaveLength(2)
    const quickstart = readFileSync(join(dir, 'src/content/quickstart.mdx'), 'utf8')
    expect(quickstart).toContain('## Before you begin')
    expect(quickstart).toContain('<Step title="Verify the result">')
    expect(quickstart).toContain('## Choose your next task')
    expect(spanishIntroduction).toContain('Te damos la bienvenida a Acme Docs')
    expect(spanishIntroduction).toContain('secondaryHref="/es/components"')
    expect(spanishIntroduction).toContain('## Crea tu documentación')
    expect(spanishIntroduction).toContain('## Publica y amplía')
    expect(spanishIntroduction.match(/<CardGroup cols="2">/g)).toHaveLength(2)
    expect(spanishIntroduction).toContain('title="Integra la API" icon="code-simple" href="/es/api"')
  })

  it('writes the exact bytes exposed to hosted creation paths', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    const expected = buildStarterFiles({
      projectName: 'Acme Docs',
      enableAiChat: true,
      repoUrl: 'https://github.com/acme/docs',
    })

    writeStarterContent(dir, 'Acme Docs', true, 'https://github.com/acme/docs')
    writeStarterReadme(dir, 'Acme Docs')
    writeStarterAgentGuide(dir, 'Acme Docs')

    for (const file of expected) {
      expect(readFileSync(join(dir, file.path), 'utf8'), file.path).toBe(file.content)
    }
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
        devDependencies: { '@thallylabs/cli': '0.5.0' },
      }),
    )
  }

  it('strips workspaces, keeps generated inputs, and renames to the site slug', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeTemplatePkg(dir)
    mkdirSync(join(dir, 'scripts'))
    writeFileSync(join(dir, 'scripts/build-runtime-sources.mts'), '// template compiler\n')
    writeFileSync(join(dir, 'package-lock.json'), '{"name":"thally","lockfileVersion":3}')

    patchPackageJson(dir, 'acme-docs')

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('acme-docs')
    expect(pkg.workspaces).toBeUndefined()
    expect(pkg.scripts.prebuild).toBe(
      'npm run runtime-sources:build && npm run embeddings:build',
    )
    expect(pkg.scripts.predev).toBe('npm run runtime-sources:build')
    expect(pkg.scripts.postinstall).toBe('npm run runtime-sources:build')
    expect(pkg.scripts.pretest).toBeUndefined()
    expect(pkg.scripts['packages:build']).toBeUndefined()
    // Untouched: the scripts a site actually runs, and registry-resolvable deps.
    expect(pkg.scripts.build).toBe('next build')
    expect(pkg.scripts['build:cloudflare']).toBe('opennextjs-cloudflare build')
    expect(pkg.scripts['deploy:cloudflare']).toContain('opennextjs-cloudflare deploy')
    // Fixture pins 0.5.0, below the floor — the floor wins.
    expect(pkg.devDependencies['@thallylabs/cli']).toBe(MIN_CLI_VERSION)
    expect(pkg.devDependencies['@opennextjs/cloudflare']).toBe('1.15.0')
    expect(pkg.devDependencies.vite).toBe('7.2.6')
    expect(pkg.devDependencies.wrangler).toBe('4.111.0')
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
        // The canonical template already pins current releases; nothing is
        // raised, so its resolved lockfile stays valid.
        dependencies: { '@thallylabs/mcp': MIN_MCP_VERSION },
        devDependencies: { '@thallylabs/cli': MIN_CLI_VERSION },
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

    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
    expect(pkg.scripts.prebuild).toBe('npm run embeddings:build')
    expect(pkg.scripts['runtime-sources:build']).toBeUndefined()
    expect(lock.name).toBe('acme-docs')
    expect(lock.packages[''].name).toBe('acme-docs')
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(true)
  })

  it('drops a stale canonical lockfile that still contains workspace packages', () => {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    mkdirSync(join(dir, 'scripts'))
    writeFileSync(join(dir, 'scripts/build-runtime-sources.mts'), '// template compiler\n')
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
    expect(pkg.dependencies['@thallylabs/mcp']).toBe(MIN_MCP_VERSION)
    expect(pkg.scripts['runtime-sources:build']).toBe('tsx scripts/build-runtime-sources.mts')
    expect(pkg.scripts.prebuild).toBe(
      'npm run runtime-sources:build && npm run embeddings:build',
    )
    expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
  })
})

// The floor constants exist to rescue stale templates. They must never rewrite
// a template that is already ahead of them: `thallylabs/docs` tracks the newest
// published releases, so an unconditional assignment turns into a downgrade the
// moment the template moves on.
describe('dependency floors — a scaffold never pins below what the template ships', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  interface ScaffoldedPkg {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  function scaffoldWith(cliPin: string, mcpPin: string): ScaffoldedPkg {
    dir = mkdtempSync(join(tmpdir(), 'thally-scaffold-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'thally',
        dependencies: { '@thallylabs/mcp': mcpPin },
        devDependencies: { '@thallylabs/cli': cliPin },
      }),
    )
    patchPackageJson(dir, 'acme-docs')
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as ScaffoldedPkg
  }

  // A future template may move ahead of these floors. Scaffolding must retain
  // that newer release rather than replacing it with the current minimum.
  it('keeps a template pin that is newer than the floor', () => {
    const pkg = scaffoldWith('0.8.0', '1.0.0')

    expect(pkg.devDependencies['@thallylabs/cli']).toBe('0.8.0')
    expect(pkg.dependencies['@thallylabs/mcp']).toBe('1.0.0')
  })

  it('leaves ranges and dist-tags alone rather than guessing their ordering', () => {
    const pkg = scaffoldWith('^0.4.0', 'latest')

    expect(pkg.devDependencies['@thallylabs/cli']).toBe('^0.4.0')
    expect(pkg.dependencies['@thallylabs/mcp']).toBe('latest')
  })

  it('resolves each pin to the newer of the template value and the floor', () => {
    expect(raisePinToFloor(undefined, '1.2.3')).toBe('1.2.3')
    expect(raisePinToFloor('*', '1.2.3')).toBe('1.2.3')
    expect(raisePinToFloor('1.2.2', '1.2.3')).toBe('1.2.3')
    expect(raisePinToFloor('1.2.3', '1.2.3')).toBe('1.2.3')
    expect(raisePinToFloor('1.2.4', '1.2.3')).toBe('1.2.4')
    expect(raisePinToFloor('1.10.0', '1.9.0')).toBe('1.10.0')
    expect(raisePinToFloor('2.0.0', '10.0.0')).toBe('10.0.0')
    expect(raisePinToFloor('~1.0.0', '1.2.3')).toBe('~1.0.0')
    expect(raisePinToFloor('1.2.3-beta.1', '1.2.3')).toBe('1.2.3-beta.1')
  })

  // Rot guard, the other direction. A floor above the newest published release
  // pins a version that does not exist on the registry; a floor above what the
  // template ships also means every scaffold discards the template's lockfile.
  // Both constants must therefore stay at or below this monorepo's releases.
  it('never floors above the versions this monorepo publishes', () => {
    const published = (pkgName: string): string =>
      (
        JSON.parse(
          readFileSync(
            fileURLToPath(new URL(`../../../${pkgName}/package.json`, import.meta.url)),
            'utf8',
          ),
        ) as { version: string }
      ).version

    // A guard that silently reads the wrong file is worse than no guard: assert
    // it resolved a real bare version before trusting the comparison below.
    expect(published('cli')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(published('mcp')).toMatch(/^\d+\.\d+\.\d+$/)
    expect(raisePinToFloor(published('cli'), MIN_CLI_VERSION)).toBe(published('cli'))
    expect(raisePinToFloor(published('mcp'), MIN_MCP_VERSION)).toBe(published('mcp'))
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
