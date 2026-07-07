import { siteConfig } from '@/data/site'
import { getI18nConfig } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'

const baseUrl = getSiteUrl()

export function buildAgentAlternateLinks(href: string) {
  const pageUrl = `${baseUrl}${href}`
  return {
    'application/json': `${pageUrl}?format=json`,
    'application/ld+json': `${pageUrl}?format=ldjson`,
  }
}

export function buildAiTxtBody(): string {
  const i18n = getI18nConfig()
  const lines: Array<string> = [
    `# ${siteConfig.name} AI Discovery File`,
    '# This file describes how AI agents and automated tools can interact with this documentation site.',
    '',
    `Site-Name: ${siteConfig.name}`,
    `Site-Description: ${siteConfig.description}`,
    `Site-URL: ${baseUrl}`,
    'Docs-Format: application/json, application/ld+json, text/markdown',
    `Docs-API: ${baseUrl}/api/docs/{slug}`,
    `Docs-Index: ${baseUrl}/api/docs-index`,
    `Docs-LLMs: ${baseUrl}/llms.txt`,
    `Docs-LLMs-Full: ${baseUrl}/llms-full.txt`,
    `Docs-MCP: ${baseUrl}/api/mcp`,
    `Docs-OpenAPI: ${baseUrl}/openapi.yaml`,
    `Docs-Locale-Default: ${i18n?.defaultLocale ?? 'en'}`,
  ]

  if (i18n && i18n.locales.length > 1) {
    lines.push(`Docs-Locales: ${i18n.locales.map((l) => l.code).join(', ')}`)
  }

  if (siteConfig.repoUrl && !siteConfig.repoUrl.includes('your-org')) {
    lines.push(`Docs-Repository: ${siteConfig.repoUrl}`)
  }

  lines.push(
    '',
    '# Content negotiation',
    '# Accept: application/json       → structured JSON payload (title, headings, nav, code blocks)',
    '# Accept: application/ld+json    → schema.org JSON-LD (TechArticle + BreadcrumbList)',
    '# Accept: text/markdown          → Markdown with YAML frontmatter',
    '# ?format=json                   → explicit JSON override',
    '# ?format=ldjson                 → explicit JSON-LD override',
    '# ?format=md                     → explicit Markdown override',
    '',
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Allow: /api/docs/',
    'Allow: /api/docs-index',
    'Allow: /api/mcp',
    'Disallow: /api/chat',
    'Disallow: /api/feedback',
    'Disallow: /api/try-it',
    'Crawl-Delay: 1',
    '',
  )

  return lines.join('\n')
}
