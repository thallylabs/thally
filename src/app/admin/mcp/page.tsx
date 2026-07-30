import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { McpView } from '@/components/admin/mcp-view'
import { siteTools } from '@/lib/mcp/site-tools'
import { getRequestOrigin } from '@/lib/cloud-link/request'
import { resolveSiteConfig } from '@/lib/site-config'
import { agentServerName } from '@/lib/agent-identity'

export default async function AdminMcpPage() {
  const session = await requireAdminPageSession()
  const origin = await getRequestOrigin()
  const effectiveSite = await resolveSiteConfig(origin)
  const endpoint = `${origin.replace(/\/$/, '')}/api/mcp`
  const tools = siteTools.map((t) => ({ name: t.name, description: t.description }))
  const ratePerMin = Number.parseInt((process.env.THALLY_MCP_RATE_PER_MIN ?? process.env.DOX_MCP_RATE_PER_MIN) ?? '60', 10)
  const canEdit = (session?.role ?? 'owner') === 'owner'
  return (
    <McpView
      endpoint={endpoint}
      serverName={agentServerName(effectiveSite.name)}
      tools={tools}
      ratePerMin={ratePerMin}
      canEdit={canEdit}
    />
  )
}
