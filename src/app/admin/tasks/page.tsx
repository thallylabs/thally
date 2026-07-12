import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { TasksView } from '@/components/admin/tasks-view'
import { CloudLockedPanel } from '@/components/admin/cloud-locked-panel'
import { getCloud } from '@/lib/cloud-bridge'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'

export default async function AdminTasksPage() {
  await requireAdminPageSession()

  // Track is a cloud-tier service — free self-hosted deployments see the
  // locked upsell panel instead (notes/thally-architecture-plan.md §1).
  const track = getCloud()?.track
  if (!track) return <CloudLockedPanel feature="track" />

  // Effective config so an admin-edited repo URL takes effect without a rebuild.
  const { repoUrl } = await getEffectiveSiteConfig()
  const tasks = await track.getDocsTasks(repoUrl)
  const trackedRepos = await track.getTrackedRepoStatuses()

  return <TasksView tasks={tasks} repoConfigured={Boolean(repoUrl)} trackedRepos={trackedRepos} />
}
