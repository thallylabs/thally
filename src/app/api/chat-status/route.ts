import { NextResponse } from 'next/server'
import { getAdminSettings } from '@/lib/admin/settings'
import { getAiConfig } from '@/data/docs'
import { DEFAULT_AI_DISCLAIMER } from '@/lib/ai-defaults'

export const runtime = 'nodejs'

/**
 * Public: whether the AI chat widget should show, plus its live name + disclaimer.
 * Lets the admin toggle chat and rename/relabel the assistant live (F1 override)
 * without making every static docs page dynamic — the client DocsChat fetches
 * this, hides itself when disabled, and reflects the admin's name + disclaimer.
 */
export async function GET() {
  const settings = await getAdminSettings()
  const ai = getAiConfig()
  const show = settings.chatEnabled ?? Boolean(ai.chat)
  const label = settings.aiLabel ?? ai.label ?? 'Ask AI'
  const disclaimer = settings.aiDisclaimer ?? DEFAULT_AI_DISCLAIMER
  return NextResponse.json({ show, label, disclaimer }, { headers: { 'Cache-Control': 'no-store' } })
}
