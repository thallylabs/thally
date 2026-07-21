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
  type MigrationWarning,
} from '@thallylabs/migrate'

import { scaffold } from '../scaffold.js'
import { initGit, installDeps } from '../utils.js'

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
  /** Optional host fetch boundary; used by Thally Cloud adapters and tests. */
  fetcher?: MigrationFetcher
}

export interface MigrateResult {
  pagesWritten: number
  assetsWritten: number
  projectDir: string
  platform: MigrationBundle['platform']
  warnings: Array<MigrationWarning>
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
    return migrateUrl({ sourceUrl: options.sourceUrl, maxPages: options.maxPages, fetcher: options.fetcher })
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
      projectName: options.projectName ?? 'My Docs',
      description: `Documentation migrated from ${new URL(options.sourceUrl).hostname}`,
      brandPreset: 'primary',
      repoUrl: bundle.sourceKind === 'repository' ? options.sourceUrl : '',
      doInstall: false,
    })
    resetFreshMigrationContent(projectDir)
  } else if (!existsSync(projectDir)) {
    throw new Error(`Project directory "${projectDir}" does not exist. Use without --into to scaffold a new one.`)
  }

  const rendered = renderMigrationFiles(bundle, {
    existingConfig: options.into ? readExistingConfig(projectDir) : undefined,
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
    initGit(projectDir)
  }
  return {
    pagesWritten: bundle.pages.length,
    assetsWritten: bundle.assets.length,
    projectDir,
    platform: bundle.platform,
    warnings: bundle.warnings,
  }
}
