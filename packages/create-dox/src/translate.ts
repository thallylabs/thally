import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { input } from '@inquirer/prompts'
import matter from 'gray-matter'
import Anthropic from '@anthropic-ai/sdk'
import pLimit from 'p-limit'

interface NavGroup {
  group: string
  pages: Array<string | NavGroup>
}

interface I18nLocale {
  code: string
  label: string
}

interface DocsJsonI18n {
  defaultLocale: string
  locales: Array<I18nLocale>
}

interface DocsJsonConfig {
  tabs: Array<{
    tab: string
    href?: string
    groups?: Array<NavGroup>
    api?: object
  }>
  i18n?: DocsJsonI18n
}

function readDocsJson(projectDir: string): DocsJsonConfig {
  const docsPath = join(projectDir, 'docs.json')
  const raw = readFileSync(docsPath, 'utf8')
  return JSON.parse(raw) as DocsJsonConfig
}

function collectPageIds(pages: Array<string | NavGroup>): Array<string> {
  const ids: Array<string> = []
  for (const page of pages) {
    if (typeof page === 'string') {
      ids.push(page)
    } else if (page && typeof page === 'object' && 'pages' in page) {
      ids.push(...collectPageIds(page.pages))
    }
  }
  return ids
}

function getAllPageIds(config: DocsJsonConfig): {
  ids: Array<string>
  skippedApiTabs: Array<string>
  hrefOnlyPages: Array<{ tab: string; pageId: string }>
} {
  const ids: Array<string> = []
  const seen = new Set<string>()
  const skippedApiTabs: Array<string> = []
  const hrefOnlyPages: Array<{ tab: string; pageId: string }> = []

  for (const tab of config.tabs) {
    if (tab.api) {
      skippedApiTabs.push(tab.tab)
      continue
    }
    // Tab with a direct href and no groups (e.g. Changelog) — derive page ID from the href
    if (!tab.groups && tab.href) {
      const pageId = tab.href.replace(/^\//, '')
      if (pageId && !seen.has(pageId)) {
        seen.add(pageId)
        ids.push(pageId)
        hrefOnlyPages.push({ tab: tab.tab, pageId })
      }
      continue
    }
    if (!tab.groups) continue
    for (const group of tab.groups) {
      for (const id of collectPageIds(group.pages)) {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
    }
  }
  return { ids, skippedApiTabs, hrefOnlyPages }
}

function findSourceFile(projectDir: string, pageId: string): string | null {
  const contentRoot = join(projectDir, 'src', 'content')
  const candidates = [
    join(contentRoot, `${pageId}.mdx`),
    join(contentRoot, `${pageId}/index.mdx`),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

const TRANSLATION_SYSTEM_PROMPT = `You are a professional documentation translator. You will receive an MDX documentation file and translate it into the target language.

CRITICAL RULES — follow exactly:
1. Translate ALL prose text, headings, and paragraphs.
2. Translate frontmatter fields: title, description, and keywords values.
3. DO NOT translate or modify MDX component names (e.g. <Note>, <Warning>, <Steps>, <Step>, <CodeGroup>, <Tabs>, <Tab>, <Card>, <Accordion>, <Columns>).
4. DO NOT translate component prop names or prop values that are identifiers.
5. DO NOT translate content inside code blocks (\`\`\` ... \`\`\`).
6. DO NOT translate inline code spans (\`...\`).
7. DO NOT translate URLs, file paths, or import statements.
8. Preserve ALL whitespace, blank lines, and indentation exactly as in the original.
9. Preserve ALL frontmatter YAML structure exactly — only translate the string values.
10. Output ONLY the translated MDX file content — no preamble, no explanation, no markdown fences.

Example (translating to Spanish):
Input frontmatter:
  title: Getting Started
  description: Learn how to use the SDK.
Output frontmatter:
  title: Comenzando
  description: Aprende a usar el SDK.

Input MDX body:
  ## Installation
  Run the following command:
  \`\`\`bash
  npm install my-sdk
  \`\`\`
  <Note>This is important.</Note>
Output MDX body:
  ## Instalación
  Ejecuta el siguiente comando:
  \`\`\`bash
  npm install my-sdk
  \`\`\`
  <Note>Esto es importante.</Note>`

export interface TranslateOptions {
  projectDir: string
  locale: string
  pages?: Array<string>
  force?: boolean
  apiKey?: string
  model?: string
  yes?: boolean
}

async function translatePage(
  sourceContent: string,
  targetLocaleLabel: string,
  targetLocaleCode: string,
  model: string,
  client: Anthropic,
): Promise<string> {
  const message = await client.messages.create({
    model,
    max_tokens: 8192,
    system: TRANSLATION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Translate the following MDX documentation file to ${targetLocaleLabel} (locale code: ${targetLocaleCode}). Output ONLY the translated MDX content.\n\n${sourceContent}`,
      },
    ],
  })

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('')

  return text.trim()
}

export async function runTranslateCommand(
  locale: string,
  pages: Array<string> | undefined,
  force: boolean,
  apiKey: string | undefined,
  model: string,
  yes: boolean,
  projectDir: string,
): Promise<void> {
  const config = readDocsJson(projectDir)

  if (!config.i18n) {
    console.error('\n  ❌ No i18n config found in docs.json.')
    console.error('     Add an "i18n" block to docs.json first:')
    console.error('     {')
    console.error('       "i18n": {')
    console.error('         "defaultLocale": "en",')
    console.error('         "locales": [{"code":"en","label":"English"},{"code":"es","label":"Español"}]')
    console.error('       }')
    console.error('     }')
    process.exit(1)
  }

  const targetLocale = config.i18n.locales.find((l) => l.code === locale)
  if (!targetLocale) {
    const available = config.i18n.locales.map((l) => l.code).join(', ')
    console.error(`\n  ❌ Locale "${locale}" not found in docs.json i18n config.`)
    console.error(`     Available locales: ${available}`)
    process.exit(1)
  }

  if (locale === config.i18n.defaultLocale) {
    console.error(`\n  ❌ Cannot translate to the default locale "${locale}".`)
    process.exit(1)
  }

  if (!apiKey) {
    console.error('\n  ❌ Anthropic API key required. Set ANTHROPIC_API_KEY or pass --api-key.')
    process.exit(1)
  }

  const { ids: allPageIds, skippedApiTabs, hrefOnlyPages } = getAllPageIds(config)

  if (skippedApiTabs.length > 0) {
    console.log(`  ℹ  Skipping API reference tab(s): ${skippedApiTabs.join(', ')}`)
    console.log('     API reference pages are auto-generated from your OpenAPI spec and cannot be translated as MDX files.')
    console.log('')
  }

  if (hrefOnlyPages.length > 0) {
    const labels = hrefOnlyPages.map(({ tab, pageId }) => `${tab} (${pageId}.mdx)`).join(', ')
    console.log(`  ℹ  Including standalone tab page(s): ${labels}`)
    console.log('')
  }

  const targetPageIds = pages ?? allPageIds

  // Find which pages need translation
  const contentRoot = join(projectDir, 'src', 'content')
  const toTranslate: Array<{ pageId: string; sourceFile: string; targetFile: string }> = []

  for (const pageId of targetPageIds) {
    const sourceFile = findSourceFile(projectDir, pageId)
    if (!sourceFile) {
      console.warn(`  ⚠  Page "${pageId}" not found in src/content — skipping.`)
      continue
    }

    // Determine target file path
    const relativeFromContent = sourceFile.slice(contentRoot.length + 1)
    const targetFile = join(contentRoot, locale, relativeFromContent)

    if (existsSync(targetFile) && !force) {
      console.log(`  ⏭  ${pageId} (already translated, use --force to overwrite)`)
      continue
    }

    toTranslate.push({ pageId, sourceFile, targetFile })
  }

  if (toTranslate.length === 0) {
    console.log('\n  ✅ Nothing to translate.')
    return
  }

  console.log(`\n  📋 ${toTranslate.length} page(s) to translate to ${targetLocale.label} (${locale}):`)
  for (const { pageId } of toTranslate) {
    console.log(`     • ${pageId}`)
  }
  console.log('')

  if (!yes) {
    const confirm = await input({
      message: '  Proceed? (Y/n):',
      default: 'Y',
    })
    if (confirm.toLowerCase() === 'n') {
      console.log('\n  Aborted.')
      return
    }
  }

  const client = new Anthropic({ apiKey })
  const limit = pLimit(3)
  let doneCount = 0
  const total = toTranslate.length

  await Promise.all(
    toTranslate.map(({ pageId, sourceFile, targetFile }) =>
      limit(async () => {
        try {
          const sourceContent = readFileSync(sourceFile, 'utf8')

          // Validate it has frontmatter
          const parsed = matter(sourceContent)
          if (!parsed.data.title) {
            console.warn(`  ⚠  ${pageId}: missing title in frontmatter — translating anyway`)
          }

          const translated = await translatePage(
            sourceContent,
            targetLocale.label,
            locale,
            model,
            client,
          )

          mkdirSync(dirname(targetFile), { recursive: true })
          writeFileSync(targetFile, translated + '\n', 'utf8')

          doneCount++
          console.log(`  ✓ [${doneCount}/${total}] ${pageId}`)
        } catch (err) {
          doneCount++
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`  ✗ [${doneCount}/${total}] ${pageId}: ${msg}`)
        }
      }),
    ),
  )

  console.log('')
  console.log(`  ✅ Translation complete! ${doneCount}/${total} pages translated.`)
  console.log(`     Files written to: src/content/${locale}/`)
}
