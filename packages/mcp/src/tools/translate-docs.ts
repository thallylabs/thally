import { z } from 'zod'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import matter from 'gray-matter'
import Anthropic from '@anthropic-ai/sdk'
import pLimit from 'p-limit'

export const translateDocsSchema = z.object({
  projectDir: z.string().describe('Path to the Dox project directory'),
  locale: z.string().describe('Target locale code, e.g. "es", "fr"'),
  pages: z.array(z.string()).optional().describe('Page IDs to translate (omit for all pages)'),
  force: z.boolean().optional().default(false).describe('Overwrite existing translation files'),
  apiKey: z.string().optional().describe('Anthropic API key (falls back to ANTHROPIC_API_KEY env var)'),
  model: z.string().optional().default('claude-sonnet-4-6').describe('Claude model to use for translation'),
})

export type TranslateDocsInput = z.infer<typeof translateDocsSchema>

interface DocsJsonI18nLocale {
  code: string
  label: string
}

interface NavGroup {
  group: string
  pages: Array<string | NavGroup>
}

interface DocsJsonConfig {
  tabs: Array<{
    tab: string
    href?: string
    groups?: Array<NavGroup>
    api?: object
  }>
  i18n?: {
    defaultLocale: string
    locales: Array<DocsJsonI18nLocale>
  }
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

function getAllPageIds(config: DocsJsonConfig): { ids: Array<string>; hrefOnlyPages: Array<{ tab: string; pageId: string }> } {
  const ids: Array<string> = []
  const seen = new Set<string>()
  const hrefOnlyPages: Array<{ tab: string; pageId: string }> = []

  for (const tab of config.tabs) {
    // Skip API-only tabs — their content is auto-generated from the OpenAPI spec
    if (tab.api && !tab.groups) continue
    // Tab with a direct href and no groups (e.g. Changelog) — include as a standalone page
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
  return { ids, hrefOnlyPages }
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
10. Output ONLY the translated MDX file content — no preamble, no explanation, no markdown fences.`

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

export async function handleTranslateDocs(input: TranslateDocsInput): Promise<string> {
  const { projectDir, locale, pages, force = false, model = 'claude-sonnet-4-6' } = input
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY or pass apiKey.')
  }

  const config = readDocsJson(projectDir)

  if (!config.i18n) {
    throw new Error('No i18n config found in docs.json. Add an "i18n" block first.')
  }

  const targetLocale = config.i18n.locales.find((l) => l.code === locale)
  if (!targetLocale) {
    const available = config.i18n.locales.map((l) => l.code).join(', ')
    throw new Error(`Locale "${locale}" not found in docs.json. Available: ${available}`)
  }

  if (locale === config.i18n.defaultLocale) {
    throw new Error(`Cannot translate to the default locale "${locale}".`)
  }

  const { ids: allPageIds, hrefOnlyPages } = getAllPageIds(config)
  const targetPageIds = pages ?? allPageIds
  const contentRoot = join(projectDir, 'src', 'content')

  const toTranslate: Array<{ pageId: string; sourceFile: string; targetFile: string }> = []
  const skipped: Array<string> = []

  for (const pageId of targetPageIds) {
    const sourceFile = findSourceFile(projectDir, pageId)
    if (!sourceFile) {
      skipped.push(`${pageId} (source not found)`)
      continue
    }

    const relativeFromContent = sourceFile.slice(contentRoot.length + 1)
    const targetFile = join(contentRoot, locale, relativeFromContent)

    if (existsSync(targetFile) && !force) {
      skipped.push(`${pageId} (already translated)`)
      continue
    }

    toTranslate.push({ pageId, sourceFile, targetFile })
  }

  if (toTranslate.length === 0) {
    return `Nothing to translate. ${skipped.length} page(s) skipped.`
  }

  const client = new Anthropic({ apiKey })
  const limit = pLimit(3)
  const results: Array<{ pageId: string; success: boolean; error?: string }> = []

  await Promise.all(
    toTranslate.map(({ pageId, sourceFile, targetFile }) =>
      limit(async () => {
        try {
          const sourceContent = readFileSync(sourceFile, 'utf8')

          // Validate frontmatter
          const parsed = matter(sourceContent)
          if (!parsed.data.title) {
            console.warn(`[translate] ${pageId}: missing title in frontmatter`)
          }

          const translated = await translatePage(sourceContent, targetLocale.label, locale, model, client)

          mkdirSync(dirname(targetFile), { recursive: true })
          writeFileSync(targetFile, translated + '\n', 'utf8')

          results.push({ pageId, success: true })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ pageId, success: false, error: msg })
        }
      }),
    ),
  )

  const succeeded = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  const lines: Array<string> = [
    `✅ Translation to ${targetLocale.label} (${locale}) complete!`,
    '',
    `  ${succeeded.length}/${toTranslate.length} pages translated successfully`,
  ]

  if (hrefOnlyPages.length > 0 && !pages) {
    const labels = hrefOnlyPages.map(({ tab, pageId }) => `${tab} (${pageId}.mdx)`).join(', ')
    lines.push('', `ℹ  Standalone tab page(s) included: ${labels}`)
  }

  if (succeeded.length > 0) {
    lines.push('', 'Translated pages:')
    for (const r of succeeded) {
      lines.push(`  ✓ ${r.pageId}`)
    }
  }

  if (failed.length > 0) {
    lines.push('', 'Failed:')
    for (const r of failed) {
      lines.push(`  ✗ ${r.pageId}: ${r.error}`)
    }
  }

  if (skipped.length > 0) {
    lines.push('', `${skipped.length} page(s) skipped`)
  }

  lines.push('', `Files written to: ${contentRoot}/${locale}/`)

  return lines.join('\n')
}
