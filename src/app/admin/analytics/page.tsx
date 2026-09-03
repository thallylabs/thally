import { AnalyticsView } from '@/components/admin/analytics-view'
import { CloudLockedPanel } from '@/components/admin/cloud-locked-panel'
import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { getCloud } from '@/lib/cloud-bridge'

export default async function AdminAnalyticsPage() {
  await requireAdminPageSession()
  // Analytics is a cloud-tier service — free self-hosted deployments see the
  // locked panel instead.
  if (!getCloud()?.analytics) return <CloudLockedPanel feature="analytics" />
  return <AnalyticsView />
}
