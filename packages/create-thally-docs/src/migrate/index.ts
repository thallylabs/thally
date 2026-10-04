/**
 * CLI materializer for the shared Thally migration engine. Discovery completes
 * before scaffolding or writing, and every generated path is proven to remain
 * inside the selected project directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  cloneGitHubRepository,
  importSourceRef,
  hydrateRemoteApiSpecs,
  migrateRepository,
  migrateUrl,
  parseGitHubRepositoryUrl,
  renderMigrationFiles,
  type MigrationBundle,
  type MigrationDocsConfig,
  type MigrationFetcher,
  type MigrationPlatform,
  type MigrationWarning,
  type SourceRefImport,
  type SourceRefMapping,
} from '@thallylabs/migrate'

import { pruneMissingSiteLinks } from '../customize.js'
import { findPublicSpecs, shadowNote } from '../public-specs.js'
import { scaffold } from '../scaffold.js'
import { initGit, installDeps } from '../utils.js'
import { validateMigration, type MigrationValidation } from './validate.js'

export interface MigrateOptions {
  sourceUrl: string
  projectDir: string
  into: boolean
  /** Retained for CLI compatibility; Markdown/MDX imports do not require a key. */
  apiKey?: string
  branch?: string
  docsDir?: string
  projectName?: string
  yes: boolean
  maxPages?: number
  /** Explicit source platform selected by an interactive or automated caller. */
  platform?: MigrationPlatform
  /** Optional host fetch boundary; used by Thally Cloud adapters and tests. */
  fetcher?: MigrationFetcher
  /** Explicitly opt out of content/build gates; the report remains unverified. */
  skipValidation?: boolean
  /** Mintlify `sourceRef` repositories to import, from `--source-ref owner/repo=<path>`. */
  sourceRefs?: Array<SourceRefMapping>
}

export interface MigrateResult {
  pagesWritten: number
  assetsWritten: number
  projectDir: string
  platform: MigrationBundle['platform']
  warnings: Array<MigrationWarning>
  validation: MigrationValidation
  reportPath: string
}

function projectPath(projectDir: string, candidate: string): string {
  const target = resolve(projectDir, candidate)
  const fromRoot = relative(resolve(projectDir), target)
  if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Generated migration path escapes the project: ${candidate}`)
  }
  return target
}

/**
 * Keep withheld access-restricted pages out of git: the new project is
 * committed by `initGit`, and a public push must not publish them. Appends to
 * (never replaces) an existing .gitignore, once.
 */
function ignoreQuarantineDirectory(projectDir: string): void {
  const ignorePath = projectPath(projectDir, '.gitignore')
  const existing = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : ''
  // The last matching rule wins in .gitignore: an existing entry only counts if
  // no later `!migration-quarantine` line re-includes the folder.
  const rules = existing.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^!?\/?migration-quarantine(?:\/(?:\*\*?)?)?$/.test(line))
  if (rules.length > 0 && !rules[rules.length - 1].startsWith('!')) return
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  writeFileSync(ignorePath, `${existing}${separator}\n# Access-restricted pages withheld by migration: local only, never commit or deploy\n/migration-quarantine/\n`)
}

function readExistingConfig(projectDir: string): MigrationDocsConfig | undefined {
  const configPath = projectPath(projectDir, 'docs.json')
  if (!existsSync(configPath)) return undefined
  return JSON.parse(readFileSync(configPath, 'utf8')) as MigrationDocsConfig
}

/**
 * Remove content authored by the starter template before materializing a fresh
 * migration. This is intentionally limited to newly scaffolded projects;
 * `--into` imports must never delete files the user already owns.
 */
function resetFreshMigrationContent(projectDir: string): void {
  const contentDirectory = projectPath(projectDir, 'src/content')
  rmSync(contentDirectory, { recursive: true, force: true })
  mkdirSync(contentDirectory, { recursive: true })

  // The scaffold's sample spec is useful for a new blank site but misleading
  // after a migration, which writes any discovered spec below `public/`.
  for (const sampleSpec of ['openapi.yaml', 'openapi.json']) {
    rmSync(projectPath(projectDir, sampleSpec), { force: true })
  }
}

/** Clone each mapped sourceRef repository (github.com only) and prepare it as a sub-site; a failed clone is a warning, not a crash. */
async function fetchSourceRefs(mappings: ReadonlyArray<SourceRefMapping>, warnings: Array<MigrationWarning>): Promise<Array<SourceRefImport>> {
  const imports: Array<SourceRefImport> = []
  for (const mapping of mappings) {
    const source = parseGitHubRepositoryUrl(`https://github.com/${mapping.repo}`)
    const root = mkdtempSync(join(tmpdir(), 'thally-source-ref-'))
    console.log(`  📦 Cloning sourceRef ${mapping.repo}...`)
    try {
      const cloneDir = join(root, 'repository')
      await cloneGitHubRepository(source, cloneDir, warnings)
      imports.push(importSourceRef(mapping, cloneDir))
    } catch (error) {
      warnings.push({ code: 'fetch-failed', message: `sourceRef ${mapping.repo} was not imported: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  return imports
}

async function discoverMigration(options: MigrateOptions): Promise<MigrationBundle> {
  const url = new URL(options.sourceUrl)
  if (url.hostname.toLowerCase() !== 'github.com') {
    if (options.sourceRefs?.length) console.warn('  ⚠  --source-ref applies only to GitHub repository sources and was ignored.')
    console.log(`  🌐 Discovering public docs at ${url.origin}${url.pathname}...`)
    return migrateUrl({
      sourceUrl: options.sourceUrl,
      platform: options.platform,
      maxPages: options.maxPages,
      fetcher: options.fetcher,
    })
  }

  const source = parseGitHubRepositoryUrl(options.sourceUrl)
  if (options.branch) source.branch = options.branch
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'thally-migrate-'))
  const cloneDir = join(temporaryRoot, 'repository')
  console.log(`  📦 Cloning ${source.owner}/${source.repo}...`)
  try {
    const cloneWarnings: Array<MigrationWarning> = []
    await cloneGitHubRepository(source, cloneDir, cloneWarnings)
    const sourceRefs = await fetchSourceRefs(options.sourceRefs ?? [], cloneWarnings)
    const bundle = migrateRepository({
      sourceRefs,
      repositoryDir: cloneDir,
      sourceUrl: options.sourceUrl,
      docsDir: options.docsDir ?? (source.docsDir || undefined),
      platform: options.platform,
    })
    const hydrated = await hydrateRemoteApiSpecs(bundle, options.fetcher)
    return cloneWarnings.length > 0 ? { ...hydrated, warnings: [...cloneWarnings, ...hydrated.warnings] } : hydrated
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

/**
 * Migrated specs are written outside `public/`, but a spec already there (from
 * an earlier import or an older release) stays served as-is. Never deleted
 * here: list it so the owner can remove it.
 */
function publicSpecWarning(projectDir: string, bundle: MigrationBundle): MigrationWarning | null {
  const { specs, skipped } = findPublicSpecs(projectDir)
  if (specs.length === 0 && skipped.length === 0) return null
  const migrated = new Set(bundle.assets.filter((asset) => asset.projectRelative).map((asset) => basename(asset.path)))
  const lines = [
    ...specs.map((spec) => `${spec.path}${migrated.has(basename(spec.path)) ? ' (same file name as a migrated spec)' : ''}${spec.hasHiddenOperations ? ' (contains x-excluded/x-hidden operations)' : ''}${shadowNote(spec.urlPath) ? ` (answers /${spec.urlPath} in place of the filtered specification)` : ''}`),
    ...skipped.map((path) => `${path} (too large to inspect)`),
  ]
  return {
    code: 'unsupported-config',
    message: `Existing OpenAPI files under public/ are served publicly as-is: ${lines.join('; ')}. Migrated specs are written to openapi/, and re-running migration does not remove old copies from public/. Delete any old copy manually (nothing was deleted), or its hidden operations stay downloadable.`,
  }
}

/** Import a GitHub docs repository or public docs URL into a Thally project. */
export async function migrateDocs(options: MigrateOptions): Promise<MigrateResult> {
  const projectDir = resolve(options.projectDir)
  const bundle = await discoverMigration(options)

  if (!options.into) {
    console.log(`\n  🏗  Scaffolding new project at ${projectDir}...`)
    await scaffold({
      projectDir,
      projectName: options.projectName ?? bundle.site?.name ?? 'My Docs',
      description: bundle.site?.description ?? `Documentation migrated from ${new URL(options.sourceUrl).hostname}`,
      brandPreset: 'primary',
      // Source provenance is not the destination repository. Migrated pages
      // live at new paths, so source URLs cannot power edit/issue actions.
      repoUrl: '',
      doInstall: false,
      colors: bundle.site?.colors,
    })
    resetFreshMigrationContent(projectDir)
    pruneMissingSiteLinks(projectDir, new Set(bundle.pages.map((page) => page.id)))
  } else if (!existsSync(projectDir)) {
    throw new Error(`Project directory "${projectDir}" does not exist. Use without --into to scaffold a new one.`)
  }

  // Preserve portable runtime capabilities, not the starter's sample pages,
  // navigation or locale setup. A source-derived Markdown setting (Mintlify
  // serves .md mirrors by default) wins over the starter's.
  if (!options.into) {
    const starterConfig = readExistingConfig(projectDir)
    if (starterConfig?.markdown) bundle.docsConfig.markdown ??= starterConfig.markdown
    // The starter's "Get started" link points at its sample quickstart. A
    // migrated source without its own primary action must not inherit it.
    if (!bundle.docsConfig.navbar?.primary) {
      bundle.docsConfig.navbar = { ...bundle.docsConfig.navbar, primary: null }
    }
    // An absent locale block invokes the runtime's legacy bilingual fallback.
    // A single-language source must not acquire a phantom translation menu.
    bundle.docsConfig.i18n ??= { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] }
  }

  if (options.into) {
    const stale = publicSpecWarning(projectDir, bundle)
    if (stale) bundle.warnings.unshift(stale)
  }

  const rendered = renderMigrationFiles(bundle, {
    existingConfig: options.into ? readExistingConfig(projectDir) : undefined,
    existingComponentRegistry: existsSync(projectPath(projectDir, 'src/mdx/custom-components.tsx'))
      ? readFileSync(projectPath(projectDir, 'src/mdx/custom-components.tsx'), 'utf8')
      : undefined,
  })
  for (const file of rendered) {
    const destination = projectPath(projectDir, file.path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, file.content)
  }

  if (bundle.quarantinedFiles?.length) ignoreQuarantineDirectory(projectDir)

  const format = (warning: MigrationWarning): string => `${warning.message}${warning.source ? ` (${warning.source})` : ''}`
  for (const warning of bundle.warnings.filter((item) => item.code !== 'gated-page')) console.warn(`  ⚠  ${format(warning)}`)
  // Access-restricted content is a security matter: keep it together, last,
  // and unmistakable so it is not lost among compatibility notes.
  const gatedWarnings = bundle.warnings.filter((item) => item.code === 'gated-page')
  if (gatedWarnings.length > 0) {
    console.warn('\n  🔒 ACCESS-RESTRICTED CONTENT — review before publishing')
    for (const warning of gatedWarnings) console.warn(`  🔒 ${format(warning)}`)
    if (bundle.droppedGatedPages) {
      console.warn(`  🔒 ${bundle.droppedGatedPages} access-restricted page(s) were dropped by the file limit: not published and not saved under migration-quarantine/; recover them from the source repository.`)
    }
    // Quarantined assets may include files the gated pages needed; the dashboard
    // settings are not in the repository. Say both once, only for gated sites.
    if (bundle.quarantinedFiles?.length || gatedWarnings.some((warning) => !/dashboard access settings/i.test(warning.message))) {
      console.warn('  🔒 Before publishing, review migration-quarantine/assets/ and the dashboard access settings of the source site.')
    }
  }
  console.log(`  ✓ Imported ${bundle.pages.length} pages and ${bundle.assets.length} assets from ${bundle.platform}.`)

  let installationFailed = false
  // Migration is a developer build workflow for owner-selected project code.
  // Disclose execution without adding another confirmation to that workflow.
  if (!options.skipValidation) console.log('  Migration validation runs project code locally, including imported MDX and components.')
  if (!options.into && !options.skipValidation) {
    try {
      installDeps(projectDir)
    } catch {
      // Imported files and static diagnostics remain useful when a registry or
      // lifecycle step fails. Always produce the same machine-readable report.
      installationFailed = true
    }
  }
  console.log('\n  Validating imported documentation...')
  const validation = await validateMigration(projectDir, options.skipValidation, installationFailed)
  // Quarantine holds withheld pages and the assets only they use; count them apart.
  const quarantinedPages = (bundle.quarantinedFiles ?? []).filter((file) => /\.mdx?$/i.test(file.path)).length
  const reportPath = projectPath(projectDir, 'migration-report.json')
  writeFileSync(reportPath, `${JSON.stringify({
    version: 1,
    sourceUrl: `${new URL(options.sourceUrl).origin}${new URL(options.sourceUrl).pathname}`,
    platform: bundle.platform,
    pages: bundle.pages.length,
    assets: bundle.assets.length,
    components: bundle.componentFiles?.length ?? 0,
    sourceRefs: bundle.sourceRefs ?? [],
    quarantined: quarantinedPages,
    quarantinedAssets: (bundle.quarantinedFiles?.length ?? 0) - quarantinedPages,
    droppedGatedPages: bundle.droppedGatedPages ?? 0,
    warnings: bundle.warnings,
    validation,
  }, null, 2)}\n`)
  for (const message of validation.messages) console.warn(`  ⚠  ${message}`)
  console.log(`  Migration report: ${reportPath}`)
  if (validation.content === 'passed' && validation.build === 'passed') {
    console.log(`  ✓ Content and production build passed.${bundle.warnings.length ? ' Review the migration warnings for compatibility limitations.' : ''}`)
  } else {
    console.warn('  Import retained, but validation is incomplete. Do not publish without reviewing the report.')
  }
  if (!options.into) initGit(projectDir)
  return {
    pagesWritten: bundle.pages.length,
    assetsWritten: bundle.assets.length,
    projectDir,
    platform: bundle.platform,
    warnings: bundle.warnings,
    validation,
    reportPath,
  }
}
