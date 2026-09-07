/**
 * CLI materializer for the shared Thally migration engine. Discovery completes
 * before scaffolding or writing, and every generated path is proven to remain
 * inside the selected project directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  cloneGitHubRepository,
  migrateRepository,
  migrateUrl,
  parseGitHubRepositoryUrl,
  renderMigrationFiles,
  type MigrationBundle,
  type MigrationDocsConfig,
  type MigrationFetcher,
  type MigrationPlatform,
  type MigrationWarning,
} from '@thallylabs/migrate'

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

async function discoverMigration(options: MigrateOptions): Promise<MigrationBundle> {
  const url = new URL(options.sourceUrl)
  if (url.hostname.toLowerCase() !== 'github.com') {
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
    await cloneGitHubRepository(source, cloneDir)
    return migrateRepository({
      repositoryDir: cloneDir,
      sourceUrl: options.sourceUrl,
      docsDir: options.docsDir ?? (source.docsDir || undefined),
      platform: options.platform,
    })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
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
      repoUrl: bundle.sourceKind === 'repository' ? options.sourceUrl : '',
      doInstall: false,
    })
    resetFreshMigrationContent(projectDir)
  } else if (!existsSync(projectDir)) {
    throw new Error(`Project directory "${projectDir}" does not exist. Use without --into to scaffold a new one.`)
  }

  // Preserve portable runtime capabilities, not the starter's sample pages,
  // navigation or locale setup. Mintlify has no equivalent Markdown toggle.
  if (!options.into) {
    const starterConfig = readExistingConfig(projectDir)
    if (starterConfig?.markdown) bundle.docsConfig.markdown = starterConfig.markdown
    // An absent locale block invokes the runtime's legacy bilingual fallback.
    // A single-language source must not acquire a phantom translation menu.
    bundle.docsConfig.i18n ??= { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }] }
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

  for (const warning of bundle.warnings) {
    console.warn(`  ⚠  ${warning.message}${warning.source ? ` (${warning.source})` : ''}`)
  }
  console.log(`  ✓ Imported ${bundle.pages.length} pages and ${bundle.assets.length} assets from ${bundle.platform}.`)

  if (!options.into) {
    installDeps(projectDir)
  }
  console.log('\n  Validating imported documentation...')
  const validation = await validateMigration(projectDir, options.skipValidation)
  const reportPath = projectPath(projectDir, 'migration-report.json')
  writeFileSync(reportPath, `${JSON.stringify({
    version: 1,
    platform: bundle.platform,
    pages: bundle.pages.length,
    assets: bundle.assets.length,
    components: bundle.componentFiles?.length ?? 0,
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
