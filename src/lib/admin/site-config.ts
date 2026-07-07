import { siteConfig } from '@/data/site'
import { getAdminSettings } from '@/lib/admin/settings'

export interface EffectiveSiteConfig {
  name: string
  description: string
  repoUrl: string
}

/** Build-config site identity with the dashboard (F1) overrides applied. */
export async function getEffectiveSiteConfig(): Promise<EffectiveSiteConfig> {
  try {
    const s = await getAdminSettings()
    return {
      name: s.siteName ?? siteConfig.name,
      description: s.siteDescription ?? siteConfig.description,
      repoUrl: s.siteRepoUrl ?? siteConfig.repoUrl ?? '',
    }
  } catch {
    return { name: siteConfig.name, description: siteConfig.description, repoUrl: siteConfig.repoUrl ?? '' }
  }
}
