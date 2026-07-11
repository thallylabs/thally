import type { NextConfig } from 'next'
import docsJson from './docs.json' assert { type: 'json' }

interface DocsRedirect {
  source: string
  destination: string
  permanent?: boolean
}

const docRedirects: Array<DocsRedirect> =
  (docsJson as { redirects?: Array<DocsRedirect> }).redirects ?? []

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx'],
  // libSQL ships a native binding; leave it as a runtime require so Next doesn't
  // try to bundle it (which breaks the analytics store on serverless builds).
  serverExternalPackages: ['@libsql/client'],
  experimental: {
    externalDir: true,
  },
  async redirects() {
    return [
      // Legacy pre-rebrand URL — the guide moved with the Dox → Thally rename.
      { source: '/guides/dox-track', destination: '/guides/thally-track', permanent: true },
      ...docRedirects.map(({ source, destination, permanent = false }) => ({
        source,
        destination,
        permanent,
      })),
    ]
  },
  // Serve the dynamic brand favicon (admin upload → else the Thally default mark)
  // for the browser's automatic /favicon.ico request. We deleted the static
  // app/favicon.ico so Next's default icon can never win; this rewrite makes
  // sure a direct /favicon.ico hit still resolves to the right icon.
  async rewrites() {
    return [
      { source: '/favicon.ico', destination: '/api/brand/favicon' },
      // Agent-discovery documents. Served by a route handler (not static
      // files) so every deployment emits absolute URLs for its own origin.
      { source: '/.well-known/api-catalog', destination: '/api/well-known/api-catalog' },
      { source: '/.well-known/mcp.json', destination: '/api/well-known/mcp-server-card' },
      { source: '/.well-known/mcp/server-card.json', destination: '/api/well-known/mcp-server-card' },
      { source: '/.well-known/agent-card.json', destination: '/api/well-known/agent-card' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/well-known/oauth-protected-resource' },
      { source: '/.well-known/agent-skills/index.json', destination: '/api/well-known/agent-skills-index' },
      { source: '/.well-known/agent-skills/:file', destination: '/api/well-known/agent-skills-file/:file' },
      { source: '/auth.md', destination: '/api/well-known/auth-md' },
    ]
  },
}

export default nextConfig
