import { Suspense } from 'react'
import { AdminLoginForm } from '@/components/admin/admin-login-form'
import { getOidcConfig } from '@/lib/auth/oidc'
import { resolveRequestSiteConfig } from '@/lib/site-config'

export default async function AdminLoginPage() {
  const oidcEnabled = Boolean(getOidcConfig())
  const effectiveSite = await resolveRequestSiteConfig()
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <AdminLoginForm siteName={effectiveSite.name} oidcEnabled={oidcEnabled} />
    </Suspense>
  )
}
