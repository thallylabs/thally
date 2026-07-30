/** Tenant-isolation coverage for public agent discovery documents. */

import { describe, expect, it } from 'vitest'
import {
  a2aAgentCard,
  mcpServerCard,
  oauthProtectedResource,
} from '@/app/api/well-known/[...document]/route'
import { agentServerName } from '@/lib/agent-identity'
import type { SiteIdentity } from '@/lib/site-config'

const identity: SiteIdentity = {
  name: 'Launch Sentinel',
  description: 'Sentinel documentation',
  repoUrl: 'https://github.com/acme/launch-sentinel',
  links: [],
}

describe('agent discovery identity', () => {
  it('uses a customer-specific MCP identifier', () => {
    expect(agentServerName(identity.name)).toBe('launch-sentinel-docs')
  })

  it('keeps every discovery card free of baseline identity', async () => {
    const responses = [
      mcpServerCard('https://sentinel.example.com', identity),
      a2aAgentCard('https://sentinel.example.com', identity),
      oauthProtectedResource('https://sentinel.example.com', identity),
    ]
    const documents = await Promise.all(
      responses.map(async (response) => JSON.stringify(await response.json())),
    )

    for (const document of documents) {
      expect(document).toContain('Launch Sentinel')
      expect(document).not.toContain('Bench Three')
      expect(document).not.toContain('Thally documentation')
      expect(document).not.toContain('thally-docs')
    }
  })
})
