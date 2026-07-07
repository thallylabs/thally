import { requireAdminPageSession } from '@/lib/auth/admin-page'
import { BrandingView } from '@/components/admin/branding-view'
import { getStructuralTheme } from '@/data/docs'
import { siteConfig } from '@/data/site'

export default async function AdminBrandingPage() {
  const session = await requireAdminPageSession()
  const canEdit = (session?.role ?? 'owner') === 'owner'
  return (
    <BrandingView
      currentTheme={getStructuralTheme()}
      currentAccentLight={siteConfig.brand.light.accent}
      currentAccentDark={siteConfig.brand.dark.accent}
      repoUrl={siteConfig.repoUrl ?? ''}
      canEdit={canEdit}
    />
  )
}
