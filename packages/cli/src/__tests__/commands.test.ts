/** Output parsing for `thally dev` and `thally deploy`. */

import { describe, expect, it } from 'vitest'
import { agentEndpointLines, isDevServerReady, mcpServerName, parseDevServerUrl } from '../commands/dev.js'
import { deploySummary, parseVercelDeploymentUrl, parseWorkersDeploymentUrl } from '../commands/deploy.js'
import { stripAnsi } from '../process.js'

describe('thally dev output', () => {
  it('reads the local URL from the Next.js banner, including a fallback port', () => {
    expect(parseDevServerUrl('   - Local:        http://localhost:3040')).toBe('http://localhost:3040')
    expect(parseDevServerUrl(stripAnsi('\u001b[2m   - Local:\u001b[22m        http://localhost:3041'))).toBe('http://localhost:3041')
    expect(parseDevServerUrl('   - Network:      http://192.168.1.4:3040')).toBeUndefined()
    expect(parseDevServerUrl('Local: not-a-url')).toBeUndefined()
  })

  it('recognizes the ready line', () => {
    expect(isDevServerReady(' ✓ Ready in 1203ms')).toBe(true)
    expect(isDevServerReady(' ○ Compiling / ...')).toBe(false)
  })

  it('derives a paste-safe MCP server name', () => {
    expect(mcpServerName('acme-docs')).toBe('acme-docs')
    expect(mcpServerName('@acme/Docs Site')).toBe('docs-site')
    expect(mcpServerName('$(rm -rf ~)')).toBe('rm-rf')
    expect(mcpServerName(undefined)).toBe('docs')
  })

  it('prints the agent endpoints and a Claude Code one-liner', () => {
    const lines = agentEndpointLines('http://localhost:3040', 'acme-docs').join('\n')
    expect(lines).toContain('http://localhost:3040/llms.txt')
    expect(lines).toContain('claude mcp add --transport http acme-docs http://localhost:3040/api/mcp')
  })
})

describe('thally deploy output', () => {
  it('reads the Vercel deployment URL from stdout', () => {
    expect(parseVercelDeploymentUrl('https://acme-docs-abc123.vercel.app')).toBe('https://acme-docs-abc123.vercel.app')
    expect(parseVercelDeploymentUrl('Inspect: https://vercel.com/acme/docs/abc [1s]')).toBeUndefined()
  })

  it('reads the workers.dev URL from Wrangler output', () => {
    expect(parseWorkersDeploymentUrl('  https://acme-docs.acme.workers.dev')).toBe('https://acme-docs.acme.workers.dev')
    expect(parseWorkersDeploymentUrl('Uploaded acme-docs (3.2 sec)')).toBeUndefined()
  })

  it('never reports a loopback URL as the deployment', () => {
    expect(parseVercelDeploymentUrl('https://localhost')).toBeUndefined()
  })

  it('reports readiness honestly without a fake URL', () => {
    const missing = deploySummary(undefined, 'below-minimum')
    expect(missing.endpoints[0]).toBe('<your-site-url>/llms.txt')
    expect(missing.readiness).toContain('below the minimum')
    expect(deploySummary('https://docs.acme.com', 'passed').endpoints).toContain('https://docs.acme.com/api/mcp')
    expect(deploySummary('https://docs.acme.com', 'unavailable').readiness).toContain('skipped')
  })
})
