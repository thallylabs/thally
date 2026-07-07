import { Suspense } from 'react'
import { AdminLoginForm } from '@/components/admin/admin-login-form'
import { siteConfig } from '@/data/site'
import { getOidcConfig } from '@/lib/auth/oidc'

export default function AdminLoginPage() {
  const oidcEnabled = Boolean(getOidcConfig())
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <AdminLoginForm siteName={siteConfig.name} oidcEnabled={oidcEnabled} />
    </Suspense>
  )
}
