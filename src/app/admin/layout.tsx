import { AdminShell } from '@/components/admin/admin-shell'
import { siteConfig } from '@/data/site'

// Admin pages must render per-request so the node-side auth guard
// (requireAdminPageSession) actually runs — otherwise they'd be prerendered
// static at build time (when no auth env is set) and the check would never fire.
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell siteName={siteConfig.name}>{children}</AdminShell>
}
