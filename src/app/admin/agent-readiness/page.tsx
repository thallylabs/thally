import { AgentReadinessPanel } from '@/components/admin/agent-readiness-panel'
import { requireAdminPageSession } from '@/lib/auth/admin-page'

export default async function AdminAgentReadinessPage() {
  await requireAdminPageSession()
  return <AgentReadinessPanel />
}
