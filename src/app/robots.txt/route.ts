import { getSiteUrl } from '@/lib/site-url'

/**
 * robots.txt as a plain route handler (replaces the typed `app/robots.ts`).
 *
 * Next's `MetadataRoute.Robots` can only serialize the classic directives, but
 * agent-ready robots.txt also carries Content-Signal lines
 * (https://contentsignals.org) declaring how AI systems may use the content.
 * A docs site exists to be read — by humans and agents — so all signals are
 * "yes" by default. Rules below mirror the previous robots.ts exactly.
 */

const AGENT_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ClaudeBot',
  'GoogleOther',
  'PerplexityBot',
  'Meta-ExternalAgent',
  'Amazonbot',
  'Bytespider',
  'CCBot',
] as const

const AGENT_ALLOW = [
  '/',
  '/llms.txt',
  '/llms-full.txt',
  '/ai.txt',
  '/api/docs',
  '/api/docs/',
  '/api/docs-index',
  '/openapi.yaml',
  '/openapi.json',
] as const

const DISALLOW = [
  '/admin',
  '/access',
  '/api/chat',
  '/api/feedback',
  '/api/og',
  '/api/try-it',
  '/api/admin',
  '/api/analytics',
] as const

const CONTENT_SIGNALS = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes'

export const dynamic = 'force-static'

export function GET(): Response {
  const baseUrl = getSiteUrl()

  const lines: Array<string> = [
    'User-Agent: *',
    CONTENT_SIGNALS,
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Allow: /ai.txt',
    'Allow: /api/docs/',
    'Allow: /api/docs-index',
    'Allow: /openapi.yaml',
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    '',
  ]

  for (const bot of AGENT_BOTS) {
    lines.push(`User-Agent: ${bot}`)
    lines.push(CONTENT_SIGNALS)
    for (const path of AGENT_ALLOW) lines.push(`Allow: ${path}`)
    for (const path of DISALLOW) lines.push(`Disallow: ${path}`)
    lines.push('')
  }

  lines.push(`Sitemap: ${baseUrl}/sitemap.xml`)
  lines.push('')

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
