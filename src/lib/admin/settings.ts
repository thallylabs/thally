import { getStorage } from '@/lib/storage'
import type { Role } from '@/lib/auth/types'

/**
 * Runtime, admin-editable settings (F1-backed) — the layer that makes the admin
 * dashboard *control* v2.1 features rather than just display config. Values here
 * override the git-committed defaults at request time.
 */
export interface AdminSettings {
  /** null → fall back to docs.json `ai.chat`; true/false → admin override. */
  chatEnabled: boolean | null
  /** null → fall back to docs.json `analytics.enabled` (on); true/false → override. */
  analyticsEnabled: boolean | null
  /** null → on; false → disable the public /api/mcp endpoint. */
  mcpEnabled: boolean | null
  /** Live structural-theme override (default/maple/sharp/minimal), or null. */
  brandTheme: string | null
  /** Live brand accent override (hex per mode), or null. */
  brandAccent: { light: string; dark: string } | null
  /** Site identity overrides (dashboard-editable), or null to use build config. */
  siteName: string | null
  siteDescription: string | null
  siteRepoUrl: string | null
  /** Custom name for the AI assistant (FAB, chat header), or null for the build default. */
  aiLabel: string | null
  /** Custom disclaimer shown at the foot of the assistant panel, or null for the generic default. */
  aiDisclaimer: string | null
  /** Extra OIDC access domains, merged with the git-committed `team.domains`. */
  allowedDomains: Array<{ domain: string; role: Role }>
  /** scrypt hash of the docs-access (visitor) password. Never returned by the API. */
  docsPasswordHash: string | null
  /** AES-GCM encrypted Anthropic API key (iv:tag:ct). Never returned by the API. */
  chatKeyEnc: string | null
}

const NS = 'admin_settings'
const KEY = 'settings'
const DEFAULTS: AdminSettings = {
  chatEnabled: null,
  analyticsEnabled: null,
  mcpEnabled: null,
  brandTheme: null,
  brandAccent: null,
  siteName: null,
  siteDescription: null,
  siteRepoUrl: null,
  aiLabel: null,
  aiDisclaimer: null,
  allowedDomains: [],
  docsPasswordHash: null,
  chatKeyEnc: null,
}

export async function getAdminSettings(): Promise<AdminSettings> {
  try {
    const stored = await getStorage().kvGet<Partial<AdminSettings>>(NS, KEY)
    return {
      chatEnabled: typeof stored?.chatEnabled === 'boolean' ? stored.chatEnabled : DEFAULTS.chatEnabled,
      analyticsEnabled: typeof stored?.analyticsEnabled === 'boolean' ? stored.analyticsEnabled : DEFAULTS.analyticsEnabled,
      mcpEnabled: typeof stored?.mcpEnabled === 'boolean' ? stored.mcpEnabled : DEFAULTS.mcpEnabled,
      brandTheme: typeof stored?.brandTheme === 'string' ? stored.brandTheme : DEFAULTS.brandTheme,
      brandAccent:
        stored?.brandAccent && typeof stored.brandAccent === 'object' ? stored.brandAccent : DEFAULTS.brandAccent,
      siteName: typeof stored?.siteName === 'string' ? stored.siteName : DEFAULTS.siteName,
      siteDescription: typeof stored?.siteDescription === 'string' ? stored.siteDescription : DEFAULTS.siteDescription,
      siteRepoUrl: typeof stored?.siteRepoUrl === 'string' ? stored.siteRepoUrl : DEFAULTS.siteRepoUrl,
      aiLabel: typeof stored?.aiLabel === 'string' ? stored.aiLabel : DEFAULTS.aiLabel,
      aiDisclaimer: typeof stored?.aiDisclaimer === 'string' ? stored.aiDisclaimer : DEFAULTS.aiDisclaimer,
      allowedDomains: Array.isArray(stored?.allowedDomains) ? stored!.allowedDomains! : DEFAULTS.allowedDomains,
      docsPasswordHash: typeof stored?.docsPasswordHash === 'string' ? stored.docsPasswordHash : DEFAULTS.docsPasswordHash,
      chatKeyEnc: typeof stored?.chatKeyEnc === 'string' ? stored.chatKeyEnc : DEFAULTS.chatKeyEnc,
    }
  } catch {
    return DEFAULTS
  }
}

export async function updateAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  const current = await getAdminSettings()
  const next: AdminSettings = { ...current, ...patch }
  await getStorage().kvSet(NS, KEY, next)
  return next
}

// ---------------------------------------------------------------------------
// Brand assets (logo / favicon) — stored under SEPARATE F1 keys, not in the
// settings blob, so getAdminSettings() (on hot paths) stays tiny.
// ---------------------------------------------------------------------------

export type BrandAsset = 'logo' | 'favicon'

const MAX_ASSET_BYTES = 150 * 1024
const ALLOWED_ASSET_MIME = /^image\/(png|jpeg|webp)$/ // raster only — no SVG (navigable-route XSS)

/** Validate a base64 image data URI: raster mime + decoded size cap. */
export function isValidBrandAsset(dataUri: string): boolean {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri)
  if (!match || !ALLOWED_ASSET_MIME.test(match[1])) return false
  const bytes = Buffer.from(match[2], 'base64')
  return bytes.length > 0 && bytes.length <= MAX_ASSET_BYTES
}

export async function getBrandAsset(kind: BrandAsset): Promise<string | null> {
  try {
    return await getStorage().kvGet<string>(NS, kind)
  } catch {
    return null
  }
}

export async function setBrandAsset(kind: BrandAsset, dataUri: string | null): Promise<void> {
  if (dataUri === null) await getStorage().kvDelete(NS, kind)
  else await getStorage().kvSet(NS, kind, dataUri)
}

export async function hasBrandAsset(kind: BrandAsset): Promise<boolean> {
  return Boolean(await getBrandAsset(kind))
}
