/**
 * Self-contained scaffold logic for the MCP server.
 * This is intentionally a copy of packages/create-thally-docs/src/scaffold.ts
 * so that @thallylabs/mcp is fully self-contained when run via `npx @thallylabs/mcp`.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { Readable, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import tar from 'tar'

const pipelineAsync = promisify(pipeline)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARBALL_URL = 'https://codeload.github.com/thallylabs/thally/tar.gz/main'
// Keep in sync with packages/create-thally-docs/src/download.ts (the canonical
// list, with per-entry rationale). This copy exists because @thallylabs/mcp is
// deliberately self-contained for `npx` usage — no workspace import available.
const EXCLUDE_PATHS = [
  '/cli/',
  '/packages/',
  '/node_modules/',
  '/.git/',
  '/thally-agent.yml',
  '/thally-track.yml',
  '/CODEOWNERS',
  '/CLAUDE.md',
  '/notes/',
]

const STARTER_PAGES: Record<string, string> = {
  'introduction.mdx': `---
title: Introduction
description: Welcome to {NAME} documentation.
---

## Welcome

This is the home page of your **{NAME}** documentation site, powered by [Thally](https://github.com/thallylabs/thally).

Get started by editing this file at \`src/content/introduction.mdx\`.
`,
  'quickstart.mdx': `---
title: Quickstart
description: Get up and running with {NAME} in under 5 minutes.
---

## Installation

\`\`\`bash
npm install {SLUG}
\`\`\`

## Basic usage

\`\`\`ts
import { create } from '{SLUG}'

const client = create({ apiKey: 'your-api-key' })
\`\`\`

That's it — you're ready to go!
`,
}

function buildStarterDocsJson({
  enableAiChat,
  repoUrl,
  i18nLocales,
}: {
  enableAiChat: boolean
  repoUrl?: string
  i18nLocales?: Array<{ code: string; label: string }>
}): string {
  const config: Record<string, unknown> = {}

  if (enableAiChat) {
    config.ai = { chat: true }
  }

  if (repoUrl) {
    config.navbar = {
      links: [{ label: 'GitHub', href: repoUrl, type: 'github' }],
      primary: { label: 'Get started', href: '/quickstart' },
    }
  }

  if (i18nLocales && i18nLocales.length > 0) {
    config.i18n = {
      defaultLocale: 'en',
      locales: [{ code: 'en', label: 'English' }, ...i18nLocales],
    }
  }

  config.tabs = [
    {
      tab: 'Overview',
      groups: [{ group: 'Getting Started', pages: ['introduction', 'quickstart'] }],
    },
    { tab: 'API Reference', api: { source: 'openapi.yaml' } },
    { tab: 'Changelog', href: '/changelog' },
  ]

  return JSON.stringify(config, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function run(cmd: string, cwd?: string): void {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

async function downloadTemplate(targetDir: string): Promise<void> {
  const response = await fetch(TARBALL_URL)
  if (!response.ok) {
    throw new Error(`Failed to download template: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Response body is empty')
  }
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

  await pipelineAsync(
    nodeStream,
    tar.extract({
      cwd: targetDir,
      strip: 1,
      filter: (path: string) => {
        for (const excluded of EXCLUDE_PATHS) {
          if (path.includes(excluded)) return false
        }
        return true
      },
    }),
  )
}

function writeStarterContent(
  targetDir: string,
  projectName: string,
  slug: string,
  enableAiChat = true,
  repoUrl = '',
  i18nLocales?: Array<{ code: string; label: string }>,
): void {
  const contentDir = join(targetDir, 'src', 'content')
  if (existsSync(contentDir)) {
    const entries = readdirSync(contentDir)
    for (const entry of entries) {
      execSync(`rm -rf "${join(contentDir, entry)}"`)
    }
  } else {
    mkdirSync(contentDir, { recursive: true })
  }
  for (const [filename, template] of Object.entries(STARTER_PAGES)) {
    const content = template.replace(/\{NAME\}/g, projectName).replace(/\{SLUG\}/g, slug)
    writeFileSync(join(contentDir, filename), content, 'utf8')
  }
  writeFileSync(
    join(targetDir, 'docs.json'),
    buildStarterDocsJson({ enableAiChat, repoUrl: repoUrl || undefined, i18nLocales }),
    'utf8',
  )
}

function updateSiteConfig(
  targetDir: string,
  projectName: string,
  description: string,
  brandPreset: string,
  repoUrl: string,
): void {
  const siteFile = join(targetDir, 'src', 'data', 'site.ts')
  if (!existsSync(siteFile)) return

  let source = readFileSync(siteFile, 'utf8')
  source = source.replace(/name:\s*'[^']*'/, `name: '${projectName.replace(/'/g, "\\'")}'`)
  source = source.replace(
    /description:\s*\n\s*'[^']*'/,
    `description:\n    '${description.replace(/'/g, "\\'")}'`,
  )
  source = source.replace(
    /const brandPreset:\s*BrandPresetKey\s*=\s*'[^']*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`,
  )
  if (repoUrl) {
    source = source.replace(/repoUrl:\s*'[^']*'/, `repoUrl: '${repoUrl}'`)
    source = source.replace(
      /\{\s*label:\s*'GitHub',\s*href:\s*'[^']*'\s*\}/,
      `{ label: 'GitHub', href: '${repoUrl}' }`,
    )
    source = source.replace(
      /\{\s*label:\s*'Support',\s*href:\s*'[^']*'\s*\}/,
      `{ label: 'Support', href: '${repoUrl}/issues/new' }`,
    )
  }
  writeFileSync(siteFile, source, 'utf8')
}

function patchTopBarNavigation(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'components', 'layout', 'top-bar.tsx')
  if (!existsSync(filePath)) return
  const source = readFileSync(filePath, 'utf8')
  if (!source.includes("target={isExternal ? '_blank' : undefined}")) return
  const patched = source.replace(
    /if \(collection\.href\) \{\n              const isExternal[^\n]+\n              return \(\n                <a[\s\S]*?<\/a>\n              \)\n            \}/,
    `if (collection.href) {
              const isExternal = /^https?:\\/\\//.test(collection.href)
              if (isExternal) {
                return (
                  <a
                    key={collection.id}
                    href={collection.href}
                    target="_blank"
                    rel="noreferrer"
                    className={baseClasses}
                  >
                    {collection.label}
                  </a>
                )
              }
              return (
                <Link
                  key={collection.id}
                  href={collection.href}
                  className={baseClasses}
                >
                  {collection.label}
                </Link>
              )
            }`,
  )
  writeFileSync(filePath, patched, 'utf8')
}

function patchApiReferenceGuard(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'data', 'api-reference.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  source = source.replace(
    /export async function buildApiNavigation\([^)]*\)[^{]*\{\n/,
    (match) => `${match}  if (apiReferenceConfig.specs.length === 0) return []\n`,
  )
  writeFileSync(filePath, source, 'utf8')
}

function patchOpenApiFetch(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'lib', 'openapi', 'fetch.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  source = source.replace(
    /const absolutePath = path\.isAbsolute\(filePath\) \? filePath : path\.resolve\(process\.cwd\(\), filePath\)/,
    `const absolutePath = filePath.startsWith('/')\n    ? path.resolve(process.cwd(), 'public', filePath.slice(1))\n    : path.resolve(process.cwd(), filePath)`,
  )
  writeFileSync(filePath, source, 'utf8')
}

function updateEnvExample(targetDir: string): void {
  const envFile = join(targetDir, '.env.example')
  if (existsSync(envFile)) {
    const envLocal = join(targetDir, '.env.local')
    if (!existsSync(envLocal)) cpSync(envFile, envLocal)
  }
}

function installDeps(targetDir: string): void {
  run('npm install', targetDir)
}

function initGit(targetDir: string): void {
  try {
    run('git init', targetDir)
    run('git add -A', targetDir)
    run('git commit -m "Initial commit from create-thally-docs"', targetDir)
  } catch {
    // Git not configured — that's fine
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
  const { projectDir, projectName, description, brandPreset, repoUrl, doInstall, enableAiChat = true, i18nLocales } = options
  const targetDir = resolve(projectDir)

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`)
  }

  mkdirSync(targetDir, { recursive: true })
  const slug = slugify(projectName)

  await downloadTemplate(targetDir)
  writeStarterContent(targetDir, projectName, slug, enableAiChat, repoUrl, i18nLocales)
  updateSiteConfig(targetDir, projectName, description, brandPreset, repoUrl)
  patchApiReferenceGuard(targetDir)
  patchTopBarNavigation(targetDir)
  patchOpenApiFetch(targetDir)
  updateEnvExample(targetDir)
  if (doInstall) installDeps(targetDir)
  initGit(targetDir)

  return { projectDir: targetDir }
}
