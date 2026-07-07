import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { TasksView } from '@/components/admin/tasks-view'
import { getDocsTasks } from '@/lib/tasks'
import { siteConfig } from '@/data/site'

export default async function AdminTasksPage() {
  await requireAdminPageSession()
  const repoUrl = siteConfig.repoUrl
  const tasks = await getDocsTasks(repoUrl)
  return <TasksView tasks={tasks} repoConfigured={Boolean(repoUrl)} />
}
