import { NextResponse } from 'next/server'
import { getAdminSettings } from '@/lib/admin/settings'
import { getAiConfig } from '@/data/docs'
import { DEFAULT_AI_DISCLAIMER } from '@/lib/ai-defaults'
import { isAiChatAvailable } from '@/lib/cloud-bridge'
import type { NextRequest } from 'next/server'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

export const runtime = 'nodejs'

/**
 * Public: whether the AI chat widget should show, plus its live name + disclaimer.
 * Lets the admin toggle chat and rename/relabel the assistant live (F1 override)
 * without making every static docs page dynamic — the client DocsChat fetches
 * this, hides itself when disabled, and reflects the admin's name + disclaimer.
 * Always hidden when the deployment has no AI service (OSS free tier).
 */
export async function GET(request: NextRequest) {
  const [settings, cloudConfig] = await Promise.all([
    getAdminSettings(),
    getCloudSiteConfig(request.nextUrl.origin),
  ])
  const ai = getAiConfig()
  const cloudEnabled = cloudConfig
    ? Boolean(cloudConfig.entitlements.features?.aiAnswers) &&
      Boolean(cloudConfig.siteConfig.portable.ai?.enabled)
    : null
  const show =
    (await isAiChatAvailable(request.nextUrl.origin)) &&
    (cloudEnabled ?? settings.chatEnabled ?? Boolean(ai.chat))
  const label = settings.aiLabel ?? ai.label ?? 'Ask AI'
  const disclaimer = settings.aiDisclaimer ?? DEFAULT_AI_DISCLAIMER
  // Managed builds roll forward through a protected stable-runtime overlay.
  // During that window the prior CloudPortableConfig type knows only
  // `enabled`, even though the signed JSON may already carry an icon. Widen at
  // this compatibility seam so a new route can build against the prior stable
  // type while the paired scaffold release is being promoted.
  const cloudAi = cloudConfig?.siteConfig.portable.ai as
    | { enabled?: boolean; icon?: unknown }
    | undefined
  const cloudIcon = cloudAi?.icon
  // Cloud uploads are committed to a same-origin public path. Do not reflect
  // arbitrary strings from portable configuration into an image source.
  const icon = typeof cloudIcon === 'string' && /^\/[A-Za-z0-9._/-]+$/.test(cloudIcon)
    ? cloudIcon
    : ai.icon
  return NextResponse.json({ show, label, disclaimer, icon }, { headers: { 'Cache-Control': 'no-store' } })
}
