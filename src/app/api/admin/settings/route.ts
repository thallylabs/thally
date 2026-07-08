import { NextResponse, type NextRequest } from 'next/server'
import {
  getAdminSettings,
  updateAdminSettings,
  setBrandAsset,
  hasBrandAsset,
  isValidBrandAsset,
  type AdminSettings,
  type BrandAsset,
} from '@/lib/admin/settings'
import { requireCapabilityFromRequest } from '@/lib/auth/rbac'
import { hashPassword, encryptSecret } from '@/lib/admin/secrets'
import type { Role } from '@/lib/auth/types'

export const runtime = 'nodejs'

const ROLES: Array<Role> = ['owner', 'editor', 'viewer']

/** Body may carry write-only secrets + brand-asset data URIs (never read back). */
type SettingsBody = Partial<AdminSettings> & {
  docsPassword?: string | null
  chatKey?: string | null
  logo?: string | null
  favicon?: string | null
  logoDark?: string | null
  faviconDark?: string | null
}

async function applyAsset(kind: BrandAsset, value: string | null | undefined): Promise<'invalid' | void> {
  if (value === undefined) return
  if (value === null || value === '') {
    await setBrandAsset(kind, null)
    return
  }
  if (!isValidBrandAsset(value)) return 'invalid'
  await setBrandAsset(kind, value)
}

async function fullResponse(s: AdminSettings) {
  const [hasLogo, hasFavicon, hasLogoDark, hasFaviconDark] = await Promise.all([
    hasBrandAsset('logo'),
    hasBrandAsset('favicon'),
    hasBrandAsset('logo-dark'),
    hasBrandAsset('favicon-dark'),
  ])
  return { ...sanitize(s), hasLogo, hasFavicon, hasLogoDark, hasFaviconDark }
}

/** Public shape — secrets are surfaced as booleans only, never the hash or key. */
function sanitize(s: AdminSettings) {
  return {
    chatEnabled: s.chatEnabled,
    analyticsEnabled: s.analyticsEnabled,
    mcpEnabled: s.mcpEnabled,
    brandTheme: s.brandTheme,
    brandAccent: s.brandAccent,
    siteName: s.siteName,
    siteDescription: s.siteDescription,
    siteRepoUrl: s.siteRepoUrl,
    aiLabel: s.aiLabel,
    aiDisclaimer: s.aiDisclaimer,
    allowedDomains: s.allowedDomains,
    hasDocsPassword: Boolean(s.docsPasswordHash),
    hasChatKey: Boolean(s.chatKeyEnc),
  }
}

export async function GET(request: NextRequest) {
  const session = await requireCapabilityFromRequest(request, 'view_analytics')
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await fullResponse(await getAdminSettings()))
}

export async function PUT(request: NextRequest) {
  // Settings include access control (allowed domains) → Owner only.
  const session = await requireCapabilityFromRequest(request, 'manage_team')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: SettingsBody
  try {
    body = (await request.json()) as SettingsBody
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const patch: Partial<AdminSettings> = {}
  if (typeof body.chatEnabled === 'boolean' || body.chatEnabled === null) {
    patch.chatEnabled = body.chatEnabled
  }
  if (typeof body.analyticsEnabled === 'boolean' || body.analyticsEnabled === null) {
    patch.analyticsEnabled = body.analyticsEnabled
  }
  if (typeof body.mcpEnabled === 'boolean' || body.mcpEnabled === null) {
    patch.mcpEnabled = body.mcpEnabled
  }
  if (body.brandTheme === null || (typeof body.brandTheme === 'string' && ['default', 'maple', 'sharp', 'minimal'].includes(body.brandTheme))) {
    patch.brandTheme = body.brandTheme
  }
  // Site identity — trimmed, length-capped, or null to clear.
  const siteField = (v: unknown, max: number): string | null | undefined => {
    if (v === null) return null
    if (typeof v === 'string') {
      const t = v.trim()
      return t ? t.slice(0, max) : null
    }
    return undefined
  }
  const nameVal = siteField(body.siteName, 80)
  if (nameVal !== undefined) patch.siteName = nameVal
  const descVal = siteField(body.siteDescription, 300)
  if (descVal !== undefined) patch.siteDescription = descVal
  const repoVal = siteField(body.siteRepoUrl, 200)
  if (repoVal !== undefined) {
    patch.siteRepoUrl = repoVal && /^https?:\/\//.test(repoVal) ? repoVal : repoVal === null ? null : patch.siteRepoUrl
    if (repoVal && !/^https?:\/\//.test(repoVal)) {
      return NextResponse.json({ error: 'Repository must be a valid https URL.' }, { status: 400 })
    }
  }
  // AI assistant name + disclaimer — trimmed, length-capped, or null to clear (falls back to defaults).
  const aiLabelVal = siteField(body.aiLabel, 40)
  if (aiLabelVal !== undefined) patch.aiLabel = aiLabelVal
  const aiDisclaimerVal = siteField(body.aiDisclaimer, 300)
  if (aiDisclaimerVal !== undefined) patch.aiDisclaimer = aiDisclaimerVal
  if (body.brandAccent === null) {
    patch.brandAccent = null
  } else if (body.brandAccent && typeof body.brandAccent === 'object') {
    const hex = /^#[0-9a-fA-F]{3,8}$/
    const light = String((body.brandAccent as { light?: string }).light ?? '')
    const dark = String((body.brandAccent as { dark?: string }).dark ?? '')
    if (hex.test(light) && hex.test(dark)) patch.brandAccent = { light, dark }
  }
  if (Array.isArray(body.allowedDomains)) {
    patch.allowedDomains = body.allowedDomains
      .filter((d) => d && typeof d.domain === 'string' && d.domain.trim() && ROLES.includes(d.role))
      .map((d) => ({ domain: d.domain.trim().toLowerCase().replace(/^@/, ''), role: d.role }))
  }
  // Docs-access password: hash + store on set; clear on empty/null. Write-only.
  if (typeof body.docsPassword === 'string' && body.docsPassword.trim()) {
    patch.docsPasswordHash = hashPassword(body.docsPassword)
  } else if (body.docsPassword === '' || body.docsPassword === null) {
    patch.docsPasswordHash = null
  }
  // AI-chat API key: encrypt (AES-GCM) + store on set; clear on empty/null.
  // Refuse to store without DOX_AUTH_SECRET rather than persist plaintext.
  if (typeof body.chatKey === 'string' && body.chatKey.trim()) {
    const enc = encryptSecret(body.chatKey.trim())
    if (!enc) {
      return NextResponse.json(
        { error: 'Set DOX_AUTH_SECRET to store an API key securely.' },
        { status: 400 },
      )
    }
    patch.chatKeyEnc = enc
  } else if (body.chatKey === '' || body.chatKey === null) {
    patch.chatKeyEnc = null
  }

  // Brand assets (logo/favicon, per mode) — separate F1 keys, validated (raster + size cap).
  const assetResults = await Promise.all([
    applyAsset('logo', body.logo),
    applyAsset('favicon', body.favicon),
    applyAsset('logo-dark', body.logoDark),
    applyAsset('favicon-dark', body.faviconDark),
  ])
  if (assetResults.includes('invalid')) {
    return NextResponse.json(
      { error: 'Invalid image — use PNG/JPEG/WebP under 150KB.' },
      { status: 400 },
    )
  }

  return NextResponse.json(await fullResponse(await updateAdminSettings(patch)))
}
