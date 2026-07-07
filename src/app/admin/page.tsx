import { HomeView } from '@/components/admin/home-view'
import { siteConfig } from '@/data/site'
import { requireAdminPageSession } from '@/lib/auth/admin-page'

export default async function AdminPage() {
  await requireAdminPageSession()
  return <HomeView siteName={siteConfig.name} />
}
