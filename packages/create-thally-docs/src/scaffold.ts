import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { downloadTemplate } from './download.js'
import { resetTrackingConfig, writeTrackingConfig } from './docs-json.js'
import {
  writeStarterAgentGuide,
  writeStarterContent,
  writeStarterReadme,
  writeCloudflareRuntimeConfig,
  updateSiteConfig,
  updateEnvExample,
  patchApiReferenceGuard,
  patchTopBarNavigation,
  patchOpenApiFetch,
  patchPackageJson,
  patchGitignore,
} from './customize.js'
import { slugify, installDeps, initGit } from './utils.js'

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

  // 1. Download template (replaces git clone)
  await downloadTemplate(targetDir, projectName)

  // 1a. Thally Track is opt-in — first drop the template's own tracking block so a
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

  // 2. Write starter content
  writeStarterContent(targetDir, projectName, enableAiChat, repoUrl, i18nLocales)
  writeStarterReadme(targetDir, projectName)
  writeStarterAgentGuide(targetDir, projectName)

  // 3. Update site config
  updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl)

  // 4. Patch buildApiNavigation to guard against projects with no API tab
  patchApiReferenceGuard(targetDir)

  // 5. Patch top-bar to use Next.js <Link> for internal tab hrefs (prevents full reloads)
  patchTopBarNavigation(targetDir)

  // 6. Patch openapi fetch to resolve /openapi.json relative to public/ (not fs root)
  patchOpenApiFetch(targetDir)

  // 7. Normalize package.json and regenerate a site-owned lockfile.
  patchPackageJson(targetDir, slug)

  // 7a. Every generated site is deployable to the managed Cloudflare runtime;
  // account-owned routes and credentials stay out of the customer repository.
  writeCloudflareRuntimeConfig(targetDir, slug)

  // 8. Keep dependency folders out of git even if tooling creates one below
  // the project root.
  patchGitignore(targetDir)

  // 9. Copy .env.example → .env.local
  updateEnvExample(targetDir)

  // 10. Install dependencies
  if (doInstall) {
    installDeps(targetDir)
  }

  // 11. Initialize git
  initGit(targetDir)

  return { projectDir: targetDir }
}
