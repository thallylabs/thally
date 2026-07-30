import { HomeView } from '@/components/admin/home-view'
import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { resolveRequestSiteConfig } from '@/lib/site-config'

export default async function AdminPage() {
  await requireAdminPageSession()
  const effectiveSite = await resolveRequestSiteConfig()
  return <HomeView siteName={effectiveSite.name} />
}
