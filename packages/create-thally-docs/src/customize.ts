/**
 * Documented owner-field personalization for the immutable starter tree.
 *
 * Runtime source, authored pages, navigation structure, dependencies, CI, and
 * repository policy all belong to `thallylabs/starter`. This module may change
 * only the small set of fields an owner answers during creation.
 */

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StarterLocale {
  code: string
  label: string
}

export interface StarterPersonalizationOptions {
  projectName: string
  packageName: string
  description: string
  brandPreset: string
  repoUrl: string
  enableAiChat: boolean
  i18nLocales?: Array<StarterLocale>
}

function readJsonObject(filePath: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error(`The stable Thally starter contains invalid ${label}.`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`The stable Thally starter contains invalid ${label}.`)
  }
  return value as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizedStarterLocales(
  locales: Array<StarterLocale> | undefined,
): Array<StarterLocale> {
  const normalized: Array<StarterLocale> = [{ code: 'en', label: 'English' }]
  const seen = new Set(['en'])
  for (const locale of locales ?? []) {
    const code = locale.code.trim().toLowerCase()
    const label = locale.label.trim()
    if (
      !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ||
      !label ||
      label.length > 80 ||
      seen.has(code)
    ) {
      continue
    }
    seen.add(code)
    normalized.push({ code, label })
  }
  return normalized
}

/**
 * Personalize only the owner-controlled settings in `docs.json`.
 *
 * Authored tabs, groups, pages, theme choices, and every unrelated key remain
 * byte-for-byte equivalent after JSON normalization.
 */
export function updateStarterDocsConfig(
  targetDir: string,
  enableAiChat: boolean,
  repoUrl: string,
  i18nLocales?: Array<StarterLocale>,
): void {
  const configPath = join(targetDir, 'docs.json')
  const config = readJsonObject(configPath, 'docs.json')

  const ai = isRecord(config.ai) ? { ...config.ai } : {}
  ai.chat = enableAiChat
  config.ai = ai

  const navbar = isRecord(config.navbar) ? { ...config.navbar } : {}
  const existingLinks = Array.isArray(navbar.links) ? navbar.links : []
  const links = existingLinks.filter(
    (link) =>
      !isRecord(link) ||
      (link.type !== 'github' && link.label !== 'GitHub'),
  )
  if (repoUrl) {
    links.push({ label: 'GitHub', href: repoUrl, type: 'github' })
  }
  if (links.length > 0) navbar.links = links
  else delete navbar.links
  if (Object.keys(navbar).length > 0) config.navbar = navbar
  else delete config.navbar

  config.i18n = {
    defaultLocale: 'en',
    locales: normalizedStarterLocales(i18nLocales),
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function escapeTypeScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function replaceRequired(
  source: string,
  pattern: RegExp,
  replacement: string,
  field: string,
): string {
  if (!pattern.test(source)) {
    throw new Error(`The stable Thally starter is missing owner field ${field}.`)
  }
  return source.replace(pattern, replacement)
}

/** Personalize the documented identity and repository fields in `site.ts`. */
export function updateSiteConfig(
  targetDir: string,
  projectName: string,
  description: string,
  brandPreset: string,
  repoUrl: string,
): void {
  if (!projectName.trim() || /[\0\r\n]/.test(projectName)) {
    throw new Error('The documentation project name is invalid.')
  }
  if (!['primary', 'secondary'].includes(brandPreset)) {
    throw new Error('The documentation brand preset is invalid.')
  }

  const siteFile = join(targetDir, 'src', 'data', 'site.ts')
  if (!existsSync(siteFile)) {
    throw new Error('The stable Thally starter is missing src/data/site.ts.')
  }

  const escapedName = escapeTypeScriptString(projectName)
  const escapedDescription = escapeTypeScriptString(description)
  const escapedRepoUrl = escapeTypeScriptString(repoUrl)
  let source = readFileSync(siteFile, 'utf8')
  // Keep horizontal and line-break whitespace disjoint. These expressions run
  // against downloaded starter input, so overlapping `\s*` branches would make
  // malformed input a polynomial-time denial-of-service surface.
  source = replaceRequired(
    source,
    /name:[ \t]*'(?:\\.|[^'\\\r\n])*'/,
    `name: '${escapedName}'`,
    'site.name',
  )
  source = replaceRequired(
    source,
    /description:[ \t]*(?:\r?\n[ \t]*)?'(?:\\.|[^'\\\r\n])*'/,
    `description:\n    '${escapedDescription}'`,
    'site.description',
  )
  source = replaceRequired(
    source,
    /const brandPreset:[ \t]*BrandPresetKey[ \t]*=[ \t]*'(?:\\.|[^'\\\r\n])*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`,
    'site.brandPreset',
  )
  source = replaceRequired(
    source,
    /repoUrl:[ \t]*'(?:\\.|[^'\\\r\n])*'/,
    `repoUrl: '${escapedRepoUrl}'`,
    'site.repoUrl',
  )

  source = source.replace(
    /\{[ \t]*label:[ \t]*'GitHub',[ \t]*href:[ \t]*'(?:\\.|[^'\\\r\n])*'[ \t]*\}/,
    `{ label: 'GitHub', href: '${escapedRepoUrl}' }`,
  )
  source = source.replace(
    /\{[ \t]*label:[ \t]*'Support',[ \t]*href:[ \t]*'(?:\\.|[^'\\\r\n])*'[ \t]*\}/,
    `{ label: 'Support', href: '${escapedRepoUrl ? `${escapedRepoUrl}/issues/new` : ''}' }`,
  )
  if (!repoUrl) {
    source = source.replace(
      /\r?\n[ \t]*\{[ \t]*label:[ \t]*'(?:GitHub|Support)',[ \t]*href:[ \t]*''[ \t]*\},?/g,
      '',
    )
  }

  writeFileSync(siteFile, source, 'utf8')
}

/** Rename only the root package identity; dependency pins belong to starter. */
export function updatePackageIdentity(targetDir: string, packageName: string): void {
  const packagePath = join(targetDir, 'package.json')
  const packageJson = readJsonObject(packagePath, 'package.json')
  packageJson.name = packageName
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  const lockPath = join(targetDir, 'package-lock.json')
  if (!existsSync(lockPath)) return
  const lock = readJsonObject(lockPath, 'package-lock.json')
  lock.name = packageName
  if (isRecord(lock.packages) && isRecord(lock.packages[''])) {
    lock.packages[''].name = packageName
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

/** Update the provider-portable Worker name without recreating its config. */
export function updateCloudflareRuntimeName(
  targetDir: string,
  packageName: string,
): void {
  const configPath = join(targetDir, 'wrangler.jsonc')
  if (!existsSync(configPath)) {
    throw new Error('The stable Thally starter is missing wrangler.jsonc.')
  }
  const source = readFileSync(configPath, 'utf8')
  const pattern = /("name"\s*:\s*)"(?:\\.|[^"\\])*"/
  const updated = replaceRequired(
    source,
    pattern,
    `$1${JSON.stringify(packageName)}`,
    'wrangler.name',
  )
  writeFileSync(configPath, updated, 'utf8')
}

/** Copy the canonical environment guide to the ignored local filename. */
export function updateEnvExample(targetDir: string): void {
  const envFile = join(targetDir, '.env.example')
  if (!existsSync(envFile)) return
  const envLocal = join(targetDir, '.env.local')
  if (!existsSync(envLocal)) cpSync(envFile, envLocal)
}

/** Apply the complete, intentionally narrow owner-personalization contract. */
export function personalizeStarter(
  targetDir: string,
  options: StarterPersonalizationOptions,
): void {
  updateStarterDocsConfig(
    targetDir,
    options.enableAiChat,
    options.repoUrl,
    options.i18nLocales,
  )
  updateSiteConfig(
    targetDir,
    options.projectName,
    options.description,
    options.brandPreset,
    options.repoUrl,
  )
  updatePackageIdentity(targetDir, options.packageName)
  updateCloudflareRuntimeName(targetDir, options.packageName)
}
