/**
 * The single resolution point for the effective site config.
 *
 * `siteConfig` in `src/data/site.ts` is the build-time source of truth (the
 * user authors it; the create-thally-docs scaffolder regex-patches that exact
 * file). At runtime, a few fields can be overridden from the admin dashboard
 * without a rebuild. `resolveSiteConfig()` is the one place those two layers
 * are merged, so callers never have to know which fields are override-able or
 * reach into admin storage themselves.
 *
 * Why a hook: this is also the seam a host (e.g. Thally Cloud's control plane)
 * can later substitute a different config source behind, without touching any
 * consumer. Today the default merges build config + admin KV overrides.
 *
 * Scope note — what is deliberately NOT routed through here:
 *  - `/api/brand.css` consumes the admin `brandTheme` (structural theme) and
 *    `brandAccent` (raw per-mode hex) overrides. Those are not fields of
 *    `SiteConfig` (structural theme lives in docs.json; the accent override is
 *    a partial, not a full `BrandConfig`), so folding them into this hook would
 *    distort the `SiteConfig` contract. It stays reading `getAdminSettings()`.
 *  - `/api/brand/logo` and `/api/brand/favicon` return image *bytes* from
 *    `getBrandAsset`, not config. A `SiteConfig` hook is the wrong shape for
 *    them. Both are intentionally left as-is.
 * These are documented deferrals, not oversights — see step-3 migration notes.
 */
import { siteConfig, type SiteConfig } from '@/data/site'
import { getAdminSettings } from '@/lib/admin/settings'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

/**
 * Resolve the effective site config: build-time `siteConfig` with the
 * dashboard-editable identity fields (name, description, repo URL) applied.
 * Falls back to the pristine build config if admin storage is unavailable, so
 * a free self-hosted site with no store still renders.
 */
export async function resolveSiteConfig(siteUrl?: string): Promise<SiteConfig> {
  try {
    const [s, cloud] = await Promise.all([
      getAdminSettings(),
      siteUrl ? getCloudSiteConfig(siteUrl) : Promise.resolve(null),
    ])
    const details = cloud?.siteConfig.portable.details
    return {
      ...siteConfig,
      name: details?.name ?? s.siteName ?? siteConfig.name,
      description: details?.description ?? s.siteDescription ?? siteConfig.description,
      repoUrl: s.siteRepoUrl ?? siteConfig.repoUrl ?? '',
    }
  } catch {
    return siteConfig
  }
}
