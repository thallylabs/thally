import { getI18nConfig } from '@/data/docs'
import { getSiteUrl } from '@/lib/site-url'
import type { SiteIdentity } from '@/lib/site-config'

const baseUrl = getSiteUrl()

export function buildAgentAlternateLinks(href: string, siteUrl = baseUrl) {
  const pageUrl = `${siteUrl}${href}`
  return {
    'application/json': `${pageUrl}?format=json`,
    'application/ld+json': `${pageUrl}?format=ldjson`,
  }
}

export function buildAiTxtBody(identity: SiteIdentity, siteUrl = baseUrl): string {
  const i18n = getI18nConfig()
  const lines: Array<string> = [
    `# ${identity.name} AI Discovery File`,
    '# This file describes how AI agents and automated tools can interact with this documentation site.',
    '',
    `Site-Name: ${identity.name}`,
    `Site-Description: ${identity.description}`,
    `Site-URL: ${siteUrl}`,
    'Docs-Format: application/json, application/ld+json, text/markdown',
    `Docs-API: ${siteUrl}/api/docs/{slug}`,
    `Docs-Index: ${siteUrl}/api/docs-index`,
    `Docs-LLMs: ${siteUrl}/llms.txt`,
    `Docs-LLMs-Full: ${siteUrl}/llms-full.txt`,
    `Docs-Skill: ${siteUrl}/skill.md`,
    `Docs-Agent-Guidance: ${siteUrl}/AGENTS.md`,
    `Docs-Search: ${siteUrl}/api/search?q={query}`,
    `Docs-Agent-Readiness: ${siteUrl}/api/agent-readiness`,
    `Docs-MCP: ${siteUrl}/api/mcp`,
    `Docs-OpenAPI: ${siteUrl}/openapi.yaml`,
    `Docs-Locale-Default: ${i18n?.defaultLocale ?? 'en'}`,
  ]

  if (i18n && i18n.locales.length > 1) {
    lines.push(`Docs-Locales: ${i18n.locales.map((l) => l.code).join(', ')}`)
  }

  if (identity.repoUrl && !identity.repoUrl.includes('your-org')) {
    lines.push(`Docs-Repository: ${identity.repoUrl}`)
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
    '# Agent operating instructions',
    '# Search or read the index before selecting pages.',
    '# Cite canonical page URLs and distinguish documented facts from inference.',
    '# Read /AGENTS.md before editing. The public /api/mcp endpoint is read-only.',
    '',
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Allow: /skill.md',
    'Allow: /AGENTS.md',
    'Allow: /api/docs/',
    'Allow: /api/docs-index',
    'Allow: /api/search',
    'Allow: /api/agent-readiness',
    'Allow: /api/mcp',
    'Disallow: /api/chat',
    'Disallow: /api/feedback',
    'Disallow: /api/try-it',
    'Crawl-Delay: 1',
    '',
  )

  return lines.join('\n')
}
