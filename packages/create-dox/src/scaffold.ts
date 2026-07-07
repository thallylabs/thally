import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { downloadTemplate } from './download.js'
import { writeStarterContent, updateSiteConfig, updateEnvExample, patchApiReferenceGuard, patchTopBarNavigation, patchOpenApiFetch } from './customize.js'
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

  // 2. Write starter content
  writeStarterContent(targetDir, projectName, slug, enableAiChat, repoUrl, i18nLocales)

  // 3. Update site config
  updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl)

  // 4. Patch buildApiNavigation to guard against projects with no API tab
  patchApiReferenceGuard(targetDir)

  // 5. Patch top-bar to use Next.js <Link> for internal tab hrefs (prevents full reloads)
  patchTopBarNavigation(targetDir)

  // 6. Patch openapi fetch to resolve /openapi.json relative to public/ (not fs root)
  patchOpenApiFetch(targetDir)

  // 5. Copy .env.example → .env.local
  updateEnvExample(targetDir)

  // 5. Install dependencies
  if (doInstall) {
    installDeps(targetDir)
  }

  // 6. Initialize git
  initGit(targetDir)

  return { projectDir: targetDir }
}
