import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { downloadStarter } from './download.js'
import { resetTrackingConfig, writeTrackingConfig } from './docs-json.js'
import {
  personalizeStarter,
  updateEnvExample,
} from './customize.js'
import { slugify, installDeps, initGit } from './utils.js'

export {
  STARTER_ARCHIVE_ROOT,
  STARTER_COMMIT_SHA,
  STARTER_REPOSITORY,
  validateStarterArchiveEntry,
} from './download.js'
export { STABLE_SCAFFOLD_RELEASE } from './release.js'

export interface ScaffoldOptions {
  projectDir: string
  projectName: string
  description: string
  brandPreset: string
  repoUrl: string
  doInstall: boolean
  enableAiChat?: boolean
  i18nLocales?: Array<{ code: string; label: string }>
  /** Repos to pre-register for Thally Track (opt-in). Empty/undefined = Track off. */
  trackRepos?: Array<{ owner: string; repo: string }>
}

export interface ScaffoldResult {
  projectDir: string
}

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const {
    projectDir,
    projectName,
    description,
    brandPreset,
    repoUrl,
    doInstall,
    enableAiChat = true,
    i18nLocales,
    trackRepos,
  } = options

  const targetDir = resolve(projectDir)

  // Validate target directory
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`)
  }

  // Create the target directory
  mkdirSync(targetDir, { recursive: true })

  const slug = slugify(projectName)

  // 1. Extract the complete tree from the exact promoted starter commit.
  await downloadStarter(targetDir, projectName)

  // 2. Change only the documented owner fields. Runtime code, authored pages,
  // navigation, dependencies, CI, and repository policy stay exactly as the
  // immutable starter release shipped them.
  personalizeStarter(targetDir, {
    projectName,
    packageName: slug,
    description,
    brandPreset,
    repoUrl,
    enableAiChat,
    i18nLocales,
  })

  // 2a. Thally Track is opt-in — first drop the starter's tracking block so a
  // new site never inherits thallylabs/thally, THEN write the user's repos if they
  // opted in during setup. (Order matters: reset, then apply their choice.)
  resetTrackingConfig(targetDir)
  if (trackRepos?.length) {
    writeTrackingConfig(targetDir, trackRepos)
    const list = trackRepos.map((r) => `${r.owner}/${r.repo}`).join(', ')
    console.log(`  ✓ Thally Track enabled — watching ${list} (branch main, all files; refine in docs.json).`)
    console.log('    To finish wiring it: `thally track setup` (pick a trigger) + `thally agent init`,')
    console.log('    then add your ANTHROPIC_API_KEY. See /guides/thally-track.')
  }

  // 3. Copy .env.example → .env.local
  updateEnvExample(targetDir)

  // 4. Install dependencies
  if (doInstall) {
    installDeps(targetDir)
  }

  // 5. Initialize git
  initGit(targetDir)

  return { projectDir: targetDir }
}
