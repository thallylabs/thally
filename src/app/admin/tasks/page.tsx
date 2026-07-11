import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { TasksView, type TrackedRepoStatus } from '@/components/admin/tasks-view'
import { getDocsTasks } from '@/lib/tasks'
import { getTrackingConfig } from '@/data/docs'
import { getStorage } from '@/lib/storage'
import { getEffectiveSiteConfig } from '@/lib/admin/site-config'

export default async function AdminTasksPage() {
  await requireAdminPageSession()
  // Effective config so an admin-edited repo URL takes effect without a rebuild.
  const { repoUrl } = await getEffectiveSiteConfig()
  const tasks = await getDocsTasks(repoUrl)

  // Thally Track roster + last relayed PR per repo (written by the webhook).
  // One kvList for the whole namespace, then synchronous lookups — not a
  // per-repo round-trip (which is N network calls on remote storage).
  const tracking = getTrackingConfig()
  const stateEntries = await getStorage()
    .kvList<string>('track_state')
    .catch(() => [])
  const stateByKey = new Map(stateEntries.map((entry) => [entry.key, entry.value]))
  const trackedRepos: Array<TrackedRepoStatus> = tracking.repos.map((repo) => {
    const branch = repo.branch ?? 'main'
    return {
      owner: repo.owner,
      repo: repo.repo,
      branch,
      paths: repo.paths ?? [],
      outputTab: repo.outputTab,
      lastSyncedPr: stateByKey.get(`${repo.owner}/${repo.repo}@${branch}`.toLowerCase()) ?? null,
    }
  })

  return <TasksView tasks={tasks} repoConfigured={Boolean(repoUrl)} trackedRepos={trackedRepos} />
}
