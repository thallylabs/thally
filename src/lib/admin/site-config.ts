import { resolveSiteConfig } from '@/lib/site-config'

export interface EffectiveSiteConfig {
  name: string
  description: string
  repoUrl: string
}

/**
 * Build-config site identity with the dashboard (F1) overrides applied.
 *
 * Thin projection over {@link resolveSiteConfig} — the single site-config
 * resolution point — exposing just the identity triple that the public
 * /api/site-config route and the admin tasks page consume. Kept as a named
 * helper so those callers stay unchanged while all override logic lives in one
 * place.
 */
export async function getEffectiveSiteConfig(): Promise<EffectiveSiteConfig> {
  const config = await resolveSiteConfig()
  return { name: config.name, description: config.description, repoUrl: config.repoUrl ?? '' }
}
