import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const STARTER_PAGES: Record<string, string> = {
  'introduction.mdx': `---
title: Introduction
description: Welcome to {NAME} — learn what it does, how the docs are organized, and where to start.
keywords:
  - {NAME}
  - documentation
  - overview
  - getting started
---

## Welcome

Welcome to the **{NAME}** documentation. This is your home base for guides, API
references, and everything you need to build with {NAME}. The site is powered by
[Thally](https://github.com/thallylabs/thally), an agent-native docs platform — every page
is served to humans as polished HTML and to AI agents as structured JSON, JSON-LD,
and Markdown from the same URL, so assistants can read your docs accurately.

## What you'll find here

- **Guides** — step-by-step walkthroughs of common tasks and workflows.
- **API reference** — generated from your OpenAPI spec, with a live "Try It" console.
- **Quickstart** — install {NAME} and make your first call in a few minutes.

## Next steps

Start with the [Quickstart](/quickstart) to get {NAME} running, then make this site
your own by editing \`src/content/introduction.mdx\` and updating the navigation in
\`docs.json\`. Every change you save is instantly reflected for both readers and agents.
`,
  'quickstart.mdx': `---
title: Quickstart
description: Install {NAME}, configure your API key, and make your first call in under five minutes.
keywords:
  - {NAME}
  - quickstart
  - installation
  - getting started
---

## Installation

Install {NAME} with your package manager of choice. We recommend pinning the
version in your project so builds stay reproducible across machines and CI:

\`\`\`bash
npm install {SLUG}
\`\`\`

## Basic usage

Import the client and initialize it with your API key. Keep the key in an
environment variable rather than committing it to source control, so it never
leaks into your repository or build logs:

\`\`\`ts
import { create } from '{SLUG}'

const client = create({ apiKey: process.env.API_KEY })
\`\`\`

## What's next

That's the basics — you're ready to build. Explore the guides for common workflows,
open the API reference to try endpoints against a live "Try It" console, or edit this
page at \`src/content/quickstart.mdx\` to document your own onboarding flow.
`,
  'changelog.mdx': `---
title: Changelog
description: Notable changes, releases, and improvements to {NAME}.
keywords:
  - {NAME}
  - changelog
  - releases
  - updates
---

## v0.1.0

The first release of your **{NAME}** documentation.

- Initial docs site scaffolded with [Thally](https://github.com/thallylabs/thally)
- Agent-ready endpoints live: \`/llms.txt\`, \`/ai.txt\`, \`/api/docs-index\`, and \`/api/agent-readiness\`
- Starter guides in the Overview tab and an interactive API reference

Edit this page at \`src/content/changelog.mdx\` to announce your own releases as you ship.
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

  // Opinionated defaults so new sites boot into the polished look instead of
  // the generic one. Both are plain docs.json fields the owner can change.
  config.theme = 'sharp'
  config.fonts = {
    body: { family: 'Plus Jakarta Sans', weight: ['400', '500', '600', '700'] },
    heading: { family: 'Outfit', weight: ['600', '700'] },
  }

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

export function writeStarterContent(
  targetDir: string,
  projectName: string,
  slug: string,
  enableAiChat = true,
  repoUrl = '',
  i18nLocales?: Array<{ code: string; label: string }>,
): void {
  const contentDir = join(targetDir, 'src', 'content')

  // Clear existing example content
  if (existsSync(contentDir)) {
    const entries = readdirSync(contentDir)
    for (const entry of entries) {
      const fullPath = join(contentDir, entry)
      execSync(`rm -rf "${fullPath}"`)
    }
  } else {
    mkdirSync(contentDir, { recursive: true })
  }

  // Write starter pages
  for (const [filename, template] of Object.entries(STARTER_PAGES)) {
    const content = template
      .replace(/\{NAME\}/g, projectName)
      .replace(/\{SLUG\}/g, slug)
    writeFileSync(join(contentDir, filename), content, 'utf8')
  }

  writeFileSync(
    join(targetDir, 'docs.json'),
    buildStarterDocsJson({ enableAiChat, repoUrl: repoUrl || undefined, i18nLocales }),
    'utf8',
  )
}

export function updateSiteConfig(
  targetDir: string,
  projectName: string,
  description: string,
  brandPreset: string,
  repoUrl: string,
): void {
  const siteFile = join(targetDir, 'src', 'data', 'site.ts')
  if (!existsSync(siteFile)) {
    console.log('  ⚠️  Could not find src/data/site.ts — skipping config update.')
    return
  }

  let source = readFileSync(siteFile, 'utf8')

  // Replace name
  source = source.replace(
    /name:\s*'[^']*'/,
    `name: '${projectName.replace(/'/g, "\\'")}'`,
  )

  // Replace description — only match when the quoted value follows immediately (whitespace only)
  // Avoids matching `description: string` in the interface declaration
  source = source.replace(
    /description:\s*\n\s*'[^']*'/,
    `description:\n    '${description.replace(/'/g, "\\'")}'`,
  )

  // Replace brand preset
  source = source.replace(
    /const brandPreset:\s*BrandPresetKey\s*=\s*'[^']*'/,
    `const brandPreset: BrandPresetKey = '${brandPreset}'`,
  )

  // Always reset the repo URL + links (to the user's repo, or blank) so a new
  // site NEVER inherits the Thally template's github.com/thallylabs/thally.
  source = source.replace(/repoUrl:\s*'[^']*'/, `repoUrl: '${repoUrl}'`)
  source = source.replace(
    /\{\s*label:\s*'GitHub',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'GitHub', href: '${repoUrl}' }`,
  )
  source = source.replace(
    /\{\s*label:\s*'Support',\s*href:\s*'[^']*'\s*\}/,
    `{ label: 'Support', href: '${repoUrl ? `${repoUrl}/issues/new` : ''}' }`,
  )

  writeFileSync(siteFile, source, 'utf8')
}

export function patchApiReferenceGuard(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'data', 'api-reference.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  // Guard buildApiNavigation against empty specs (no API tab in docs.json)
  source = source.replace(
    /export async function buildApiNavigation\([^)]*\)[^{]*\{\n/,
    (match) => `${match}  if (apiReferenceConfig.specs.length === 0) return []\n`,
  )
  writeFileSync(filePath, source, 'utf8')
}

export function patchTopBarNavigation(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'components', 'layout', 'top-bar.tsx')
  if (!existsSync(filePath)) return
  const source = readFileSync(filePath, 'utf8')
  // No-op if already fixed or not present
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

export function patchOpenApiFetch(targetDir: string): void {
  const filePath = join(targetDir, 'src', 'lib', 'openapi', 'fetch.ts')
  if (!existsSync(filePath)) return
  let source = readFileSync(filePath, 'utf8')
  // Fix URL-style paths (e.g. /openapi.json) to resolve relative to public/ instead of fs root
  source = source.replace(
    /const absolutePath = path\.isAbsolute\(filePath\) \? filePath : path\.resolve\(process\.cwd\(\), filePath\)/,
    `const absolutePath = filePath.startsWith('/')\n    ? path.resolve(process.cwd(), 'public', filePath.slice(1))\n    : path.resolve(process.cwd(), filePath)`,
  )
  writeFileSync(filePath, source, 'utf8')
}

export function updateEnvExample(targetDir: string): void {
  const envFile = join(targetDir, '.env.example')
  if (existsSync(envFile)) {
    const envLocal = join(targetDir, '.env.local')
    if (!existsSync(envLocal)) {
      cpSync(envFile, envLocal)
    }
  }
}
