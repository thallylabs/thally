import { SettingsView } from '@/components/admin/settings-view'
import { requireAdminPageSession } from '@/lib/auth/admin-page'

export default async function AdminSettingsPage() {
  const session = await requireAdminPageSession()
  return <SettingsView role={session?.role ?? 'owner'} />
}
