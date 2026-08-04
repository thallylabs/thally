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
  '/.well-known/llms.txt',
  '/ai.txt',
  '/skill.md',
  '/AGENTS.md',
  '/api/docs',
  '/api/docs/',
  '/api/docs-index',
  '/api/search',
  '/api/agent-readiness',
  '/api/mcp',
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

export function GET(request: Request): Response {
  const baseUrl = new URL(request.url).origin

  const lines: Array<string> = [
    'User-Agent: *',
    CONTENT_SIGNALS,
    '# Agent index: /llms.txt',
    '# Agent capability and retrieval instructions: /skill.md',
    '# Repository editing instructions: /AGENTS.md',
    'Allow: /',
    'Allow: /llms.txt',
    'Allow: /llms-full.txt',
    'Allow: /.well-known/llms.txt',
    'Allow: /ai.txt',
    'Allow: /skill.md',
    'Allow: /AGENTS.md',
    'Allow: /api/docs/',
    'Allow: /api/docs-index',
    'Allow: /api/search',
    'Allow: /api/agent-readiness',
    'Allow: /api/mcp',
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
