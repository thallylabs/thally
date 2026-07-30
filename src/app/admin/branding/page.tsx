import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { BrandingView } from '@/components/admin/branding-view'
import { getStructuralTheme } from '@/data/docs'
import { siteConfig } from '@/data/site'
import { resolveRequestSiteConfig } from '@/lib/site-config'

export default async function AdminBrandingPage() {
  const session = await requireAdminPageSession()
  const effectiveSite = await resolveRequestSiteConfig()
  const canEdit = (session?.role ?? 'owner') === 'owner'
  return (
    <BrandingView
      currentTheme={getStructuralTheme()}
      currentAccentLight={siteConfig.brand.light.accent}
      currentAccentDark={siteConfig.brand.dark.accent}
      repoUrl={effectiveSite.repoUrl}
      canEdit={canEdit}
    />
  )
}
