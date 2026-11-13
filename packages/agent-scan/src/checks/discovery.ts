/** Discovery checks: llms.txt, llms-full.txt, sitemap, AI-agent robots rules and agent manifests. */

import { methodology } from '../methodology/methodology.js'
import type { SiteFacts } from '../facts.js'
import type { FetchOutcome } from '../types.js'
import { robotsPath } from '../url.js'
import { binary, notApplicable, type CheckOutcome } from './shared.js'

/** A `text/*` media type that is not HTML. */
export function isPlainTextType(contentType: string | null): boolean {
  return !!contentType && contentType.startsWith('text/') && contentType !== 'text/html'
}

/** llms.txt validity: 200, non-HTML text, body starts with `# `. */
export function isValidLlmsTxt(outcome: FetchOutcome): boolean {
  if (outcome.error || outcome.status !== 200 || !isPlainTextType(outcome.contentType)) return false
  return (outcome.text ?? '').replace(/^﻿/, '').trimStart().startsWith('# ')
}

/** llms-full.txt validity: 200, non-HTML text, more than the minimum bytes. */
export function isValidLlmsFull(outcome: FetchOutcome): boolean {
  if (outcome.error || outcome.status !== 200 || !isPlainTextType(outcome.contentType)) return false
  return outcome.bytes > methodology.probes.llmsFullMinBytes
}

/** A JSON media type: `application/json` or any `+json` suffix. */
export function isJsonType(contentType: string | null): boolean {
  return !!contentType && (contentType === 'application/json' || contentType.endsWith('+json'))
}

/** Parse a body as a JSON object; null when it is not one. */
export function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** Well-known manifest validity: 200, JSON media type, JSON object body. */
export function isValidManifest(outcome: FetchOutcome): boolean {
  return !outcome.error && outcome.status === 200 && isJsonType(outcome.contentType) && parseJsonObject(outcome.text) !== null
}

function urls(outcomes: FetchOutcome[]): string[] {
  return outcomes.map((outcome) => outcome.requestedUrl)
}

/** `discovery.llms_txt` */
export function llmsTxt(facts: SiteFacts): CheckOutcome {
  const { hit, attempts, skippedForBudget } = facts.llms
  if (hit) return binary(true, [hit.requestedUrl], 'llms.txt found.')
  if (skippedForBudget) return notApplicable('budget', 'llms.txt probe skipped: request budget exhausted.', urls(attempts))
  return binary(false, urls(attempts), 'No valid llms.txt found.')
}

/** `discovery.llms_full_txt` */
export function llmsFullTxt(facts: SiteFacts): CheckOutcome {
  const { hit, attempts, skippedForBudget } = facts.llmsFull
  if (hit) return binary(true, [hit.requestedUrl], 'llms-full.txt found.')
  if (skippedForBudget) return notApplicable('budget', 'llms-full.txt probe skipped: request budget exhausted.', urls(attempts))
  return binary(false, urls(attempts), 'No valid llms-full.txt found.')
}

/** `discovery.sitemap` */
export function sitemap(facts: SiteFacts): CheckOutcome {
  const { attempts, parsed, locsUnderRoot, skippedForBudget } = facts.sitemap
  if (locsUnderRoot > 0) return binary(true, parsed, `Sitemap lists ${locsUnderRoot} URLs under the docs root.`)
  if (skippedForBudget) return notApplicable('budget', 'Sitemap probe skipped: request budget exhausted.', urls(attempts))
  return binary(false, urls(attempts), parsed.length > 0 ? 'Sitemap lists no URLs under the docs root.' : 'No valid sitemap found.')
}

/** `discovery.robots_ai_agents` (reported, not scored) */
export function robotsAiAgents(facts: SiteFacts): CheckOutcome {
  const path = robotsPath(facts.docsRoot)
  const blocked = methodology.probes.aiBotTokens.filter((token) => !facts.robots.rules.isAllowed(token, path))
  const evidence = facts.robots.found ? [new URL('/robots.txt', facts.docsRoot).href] : []
  if (blocked.length === 0) return binary(true, evidence, 'robots.txt allows the listed AI agents on the docs root.')
  return binary(false, evidence, `robots.txt blocks ${blocked.join(', ')} on the docs root.`)
}

/** The first absolute URL in a text whose host starts with `mcp.` or whose path has an `mcp` segment. */
export function mcpUrlIn(text: string): string | null {
  for (const match of text.matchAll(/https?:\/\/[^\s<>()"'`\]]+/g)) {
    try {
      const url = new URL(match[0])
      if (url.hostname.toLowerCase().startsWith('mcp.')) return url.href
      if (url.pathname.split('/').some((segment) => segment.toLowerCase() === 'mcp')) return url.href
    } catch {
      // Not a URL.
    }
  }
  return null
}

/**
 * Whether a response to an MCP URL from llms.txt looks like an endpoint
 * rather than a documentation page: 400, 405 or 406 (a protocol endpoint
 * refusing a plain GET), a 401 carrying `WWW-Authenticate` (an MCP server
 * asking for authorization), or a 2xx JSON or event-stream response, or any 2xx
 * non-HTML response at a path whose last segment is `mcp`. A 200 HTML page
 * is not.
 */
export function isPlausibleMcpEndpoint(outcome: FetchOutcome): boolean {
  if (outcome.error || outcome.status === null) return false
  if ([400, 405, 406].includes(outcome.status)) return true
  if (outcome.status === 401) return outcome.headers.some(([name]) => name.toLowerCase() === 'www-authenticate')
  if (outcome.status < 200 || outcome.status > 299) return false
  const type = outcome.contentType
  if (isJsonType(type) || type === 'text/event-stream') return true
  const isHtml = type === 'text/html' || type === 'application/xhtml+xml'
  const lastSegment = new URL(outcome.finalUrl).pathname.split('/').filter(Boolean).pop()?.toLowerCase()
  return !isHtml && lastSegment === 'mcp'
}

/** `discovery.agent_manifest` */
export function agentManifest(facts: SiteFacts): CheckOutcome {
  if (facts.wellKnown.hit) return binary(true, [facts.wellKnown.hit.requestedUrl], 'Agent or MCP manifest found at a well-known path.')
  const mcp = facts.mcpEndpoint
  if (mcp.url && mcp.isEndpoint && facts.llms.hit) {
    return binary(true, [facts.llms.hit.requestedUrl, mcp.url], 'llms.txt links an MCP endpoint.')
  }
  const root = facts.pages[0]
  if (root?.html?.linkRelMcp || facts.rootLinkHeaderMcp) return binary(true, [root.outcome.finalUrl], 'Docs root declares an MCP link.')
  if (facts.wellKnown.skippedForBudget || mcp.skippedForBudget) {
    return notApplicable('budget', 'Manifest or MCP endpoint probes skipped: request budget exhausted.', urls(facts.wellKnown.attempts))
  }
  const evidence = [...urls(facts.wellKnown.attempts), ...(mcp.url ? [mcp.url] : [])]
  const mcpError = mcp.outcome?.error
  const detail = !mcp.url
    ? 'No agent or MCP manifest found.'
    : mcpError
      ? `No agent or MCP manifest found; the MCP URL in llms.txt could not be fetched (${mcpError}).`
      : 'No agent or MCP manifest found; the MCP URL in llms.txt is not an endpoint.'
  return binary(false, evidence, detail)
}
