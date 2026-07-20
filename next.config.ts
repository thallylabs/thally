import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import docsJson from './docs.json' assert { type: 'json' }

// Make Wrangler bindings available while `next dev` is running. Production
// receives the same bindings from the OpenNext-generated Worker entrypoint.
initOpenNextCloudflareForDev()

interface DocsRedirect {
  source: string
  destination: string
  permanent?: boolean
}

const docRedirects: Array<DocsRedirect> =
  (docsJson as { redirects?: Array<DocsRedirect> }).redirects ?? []

const nextConfig: NextConfig = {
  pageExtensions: ['ts', 'tsx'],
  // The engine core is a workspace package shipped as TS-built ESM; let Next
  // transpile it so app routes and (server) components can import it directly.
  // OpenNext cannot load arbitrary Node externals inside workerd. Transpiling
  // these packages lets its final bundle select libSQL's `workerd` export and
  // include the MDX compiler used by dynamic documentation routes.
  transpilePackages: ['@thallylabs/core', '@libsql/client', 'next-mdx-remote', 'shiki'],
  // Several agent surfaces intentionally read customer-owned source/config at
  // runtime. Include those files in the server trace so workerd's read-only fs
  // contains the same project inputs as a Node deployment.
  outputFileTracingIncludes: {
    '/*': ['./AGENTS.md', './docs.json', './openapi.yaml', './public/**/*', './src/content/**/*'],
  },
  experimental: {
    externalDir: true,
  },
  async redirects() {
    return [
      // Legacy pre-rebrand URL — Track is now documented in the AI features guide.
      { source: '/guides/dox-track', destination: '/guides/ai-features', permanent: true },
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
