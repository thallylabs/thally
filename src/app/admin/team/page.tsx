import { TeamView } from '@/components/admin/team-view'
import { getTeamConfig } from '@/data/docs'
import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { resolveRequestSiteConfig } from '@/lib/site-config'

export default async function AdminTeamPage() {
  // Enforce the live roster: a removed/downgraded member is redirected to login,
  // never shown as Owner. null only for an unconfigured (open-dev) admin.
  const session = await requireAdminPageSession()
  const viewerRole = session?.role ?? 'owner'
  const viewerEmail = session?.email ?? 'break-glass (password)'
  const team = getTeamConfig()
  const effectiveSite = await resolveRequestSiteConfig()

  return (
    <TeamView
      members={team.members}
      domains={team.domains}
      viewerRole={viewerRole}
      viewerEmail={viewerEmail}
      repoUrl={effectiveSite.repoUrl}
    />
  )
}
