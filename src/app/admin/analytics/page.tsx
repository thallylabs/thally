import { AnalyticsView } from '@/components/admin/analytics-view'
import { requireAdminPageSession } from '@/lib/auth/admin-page'

export default async function AdminAnalyticsPage() {
  await requireAdminPageSession()
  return <AnalyticsView />
}
