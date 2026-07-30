import { AdminShell } from '@/components/admin/admin-shell'
import { resolveRequestSiteConfig } from '@/lib/site-config'

// Admin pages must render per-request so the node-side auth guard
// (requireAdminPageSession) actually runs — otherwise they'd be prerendered
// static at build time (when no auth env is set) and the check would never fire.
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const effectiveSite = await resolveRequestSiteConfig()
  return <AdminShell siteName={effectiveSite.name}>{children}</AdminShell>
}
