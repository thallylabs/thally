import type { NextRequest } from 'next/server'

export const KNOWN_BOT_UA = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'anthropic-ai',
  'Gemini-Deep-Research',
  'GoogleOther',
  'PerplexityBot',
  'Meta-ExternalAgent',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'python-requests',
  'node-fetch',
  'Go-http-client',
] as const

export type VisitorType = 'agent' | 'human'

export type AgentSignal =
  | 'format_param'
  | 'accept_header'
  | 'x_dox_client'
  | 'user_agent'
  | 'discovery_path'

export interface TrafficClassification {
  visitorType: VisitorType
  agentSignal?: AgentSignal
  format?: 'json' | 'ldjson' | 'markdown' | 'html'
}

export function classifyRequest(req: NextRequest, pathname: string): TrafficClassification {
  if (isDiscoveryPath(pathname)) {
    return { visitorType: 'agent', agentSignal: 'discovery_path', format: 'html' }
  }

  if (
    req.headers.has('next-router-state-tree') ||
    req.headers.has('rsc') ||
    req.headers.has('next-router-prefetch')
  ) {
    return { visitorType: 'human', format: 'html' }
  }

  const format = req.nextUrl.searchParams.get('format')
  if (format === 'json' || format === 'ldjson') {
    return {
      visitorType: 'agent',
      agentSignal: 'format_param',
      format: format === 'ldjson' ? 'ldjson' : 'json',
    }
  }
  if (format === 'md') {
    return { visitorType: 'agent', agentSignal: 'format_param', format: 'markdown' }
  }

  const accept = req.headers.get('accept') ?? ''
  if (accept.includes('application/ld+json')) {
    return { visitorType: 'agent', agentSignal: 'accept_header', format: 'ldjson' }
  }
  if (accept.includes('application/json')) {
    return { visitorType: 'agent', agentSignal: 'accept_header', format: 'json' }
  }
  if (accept.includes('text/markdown')) {
    return { visitorType: 'agent', agentSignal: 'accept_header', format: 'markdown' }
  }

  if (req.headers.get('x-dox-client')?.toLowerCase() === 'agent') {
    return { visitorType: 'agent', agentSignal: 'x_dox_client', format: 'json' }
  }

  const ua = req.headers.get('user-agent') ?? ''
  if (KNOWN_BOT_UA.some((bot) => ua.includes(bot))) {
    return { visitorType: 'agent', agentSignal: 'user_agent', format: 'json' }
  }

  if (pathname.endsWith('.md')) {
    return { visitorType: 'agent', agentSignal: 'format_param', format: 'markdown' }
  }

  return { visitorType: 'human', format: 'html' }
}

export function isAgentRequest(req: NextRequest, pathname: string): boolean {
  return classifyRequest(req, pathname).visitorType === 'agent'
}

function isDiscoveryPath(pathname: string): boolean {
  return (
    pathname === '/llms.txt' ||
    pathname === '/llms-full.txt' ||
    pathname === '/ai.txt' ||
    pathname === '/api/docs-index' ||
    pathname.startsWith('/api/docs/') ||
    pathname.startsWith('/api/markdown/')
  )
}
