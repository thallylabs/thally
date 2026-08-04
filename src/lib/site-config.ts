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
import { getCloudSiteConfig, getManagedSiteConfigSnapshot } from '@/lib/cloud-link/client'
import { getRequestOrigin } from '@/lib/cloud-link/request'

export interface SiteIdentity {
  name: string
  description: string
  repoUrl: string
  links: SiteConfig['links']
}

function managedRepositoryLinks(repoUrl: string): SiteConfig['links'] {
  const normalized = repoUrl.replace(/\/+$/, '')
  return [
    { label: 'Get started', href: '/quickstart' },
    { label: 'Support', href: `${normalized}/issues/new` },
    { label: 'GitHub', href: normalized },
    { label: 'Changelog', href: '/changelog' },
  ]
}

function isCompleteManagedIdentity(
  details: { name?: string; description?: string; repoUrl?: string } | undefined,
): details is { name: string; description: string; repoUrl: string } {
  return Boolean(
    details?.name?.trim() &&
      typeof details.description === 'string' &&
      details.repoUrl?.trim(),
  )
}

function unavailableManagedSiteConfig(): SiteConfig {
  return {
    ...siteConfig,
    name: 'Documentation',
    description: 'Site identity is temporarily unavailable.',
    repoUrl: '',
    links: [
      { label: 'Get started', href: '/quickstart' },
      { label: 'Changelog', href: '/changelog' },
    ],
  }
}

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
    if (
      process.env.THALLY_BASELINE_FORK_IDENTITY_REQUIRED === 'true' &&
      !isCompleteManagedIdentity(details)
    ) {
      return unavailableManagedSiteConfig()
    }
    const repoUrl = details?.repoUrl ?? s.siteRepoUrl ?? siteConfig.repoUrl ?? ''
    // A forked release runs the baseline's compiled site.ts. The runtime repo
    // mismatch is therefore the durable signal that its fallback links also
    // belong to the baseline and must be reconstructed for this customer.
    const links =
      details?.repoUrl &&
      details.repoUrl.replace(/\/+$/, '') !== (siteConfig.repoUrl ?? '').replace(/\/+$/, '')
        ? managedRepositoryLinks(details.repoUrl)
        : siteConfig.links
    return {
      ...siteConfig,
      name: details?.name ?? s.siteName ?? siteConfig.name,
      description: details?.description ?? s.siteDescription ?? siteConfig.description,
      repoUrl,
      links,
    }
  } catch {
    if (process.env.THALLY_BASELINE_FORK_IDENTITY_REQUIRED === 'true') {
      return unavailableManagedSiteConfig()
    }
    return siteConfig
  }
}

/** Resolve the request-bound identity used by every human and agent surface. */
export async function resolveRequestSiteConfig(): Promise<SiteConfig> {
  return resolveSiteConfig(await getRequestOrigin())
}

/**
 * Resolve the identity that can be embedded in an immutable documentation
 * release. Managed hosting supplies a release-scoped snapshot; self-hosted
 * sites use their repository config. Live dashboard edits still hydrate over
 * `/api/site-config`, without making every documentation navigation a server
 * request.
 */
export function resolveBuildSiteConfig(): SiteConfig {
  const details = getManagedSiteConfigSnapshot()?.siteConfig.portable.details
  if (
    process.env.THALLY_BASELINE_FORK_IDENTITY_REQUIRED === 'true' &&
    !isCompleteManagedIdentity(details)
  ) {
    return unavailableManagedSiteConfig()
  }

  if (!details) return siteConfig
  const repoUrl = details.repoUrl ?? siteConfig.repoUrl ?? ''
  const links =
    details.repoUrl &&
    details.repoUrl.replace(/\/+$/, '') !== (siteConfig.repoUrl ?? '').replace(/\/+$/, '')
      ? managedRepositoryLinks(details.repoUrl)
      : siteConfig.links

  return {
    ...siteConfig,
    name: details.name ?? siteConfig.name,
    description: details.description ?? siteConfig.description,
    repoUrl,
    links,
  }
}

/** Narrow the effective config to the serializable identity used by clients. */
export function siteIdentity(config: SiteConfig): SiteIdentity {
  return {
    name: config.name,
    description: config.description,
    repoUrl: config.repoUrl ?? '',
    links: config.links,
  }
}
