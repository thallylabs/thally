import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { McpView } from '@/components/admin/mcp-view'
import { siteTools } from '@/lib/mcp/site-tools'
import { getSiteUrl } from '@/lib/site-url'

export default async function AdminMcpPage() {
  const session = await requireAdminPageSession()
  const endpoint = `${getSiteUrl().replace(/\/$/, '')}/api/mcp`
  const tools = siteTools.map((t) => ({ name: t.name, description: t.description }))
  const ratePerMin = Number.parseInt(process.env.DOX_MCP_RATE_PER_MIN ?? '60', 10)
  const canEdit = (session?.role ?? 'owner') === 'owner'
  return <McpView endpoint={endpoint} tools={tools} ratePerMin={ratePerMin} canEdit={canEdit} />
}
