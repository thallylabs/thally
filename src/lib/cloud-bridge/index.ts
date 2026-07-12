/**
 * Engine-side access point for cloud-tier services (Track, AI answers,
 * analytics). This is the ONLY module allowed to import `@/cloud` — an ESLint
 * boundary enforces it. See src/lib/cloud-bridge/types.ts for the contract.
 *
 * `@/cloud` always resolves: to the real services in this repo (and in Thally
 * Cloud deployments), or to the no-op stub the OSS distribution ships. Every
 * consumer handles `getCloud()` returning null-ish services gracefully.
 */

import { cloudServices } from '@/cloud'
import type { AnalyticsEvent } from '@/lib/analytics/types'
import type { CloudServices, Entitlements } from './types'

export type * from './types'

export function getCloud(): CloudServices | null {
  return cloudServices
}

const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  features: { aiChat: false, track: false, analytics: false, readinessGate: false, teams: false },
}

/**
 * The single tier oracle for engine code (admin panels read ONLY this to
 * decide locked vs active). Transitional: presence of the cloud subtree grants
 * `self-hosted-full`; the token-backed control plane replaces this resolution
 * (notes/thally-cloud-plan.md §4) without changing any consumer.
 */
export function getEntitlements(): Entitlements {
  const cloud = getCloud()
  if (!cloud) return FREE_ENTITLEMENTS
  return {
    plan: 'self-hosted-full',
    features: {
      aiChat: Boolean(cloud.ai),
      track: Boolean(cloud.track),
      analytics: Boolean(cloud.analytics),
      readinessGate: false,
      teams: false,
    },
  }
}

/**
 * Best-effort analytics recording for engine call sites (search, feedback,
 * docs traffic). Silently no-ops when the analytics service is absent — a free
 * self-hosted site simply records nothing.
 */
export async function recordAnalyticsEvent(
  event: Omit<AnalyticsEvent, 'id' | 'ts'> & { ts?: number },
): Promise<void> {
  const analytics = getCloud()?.analytics
  if (!analytics) return
  await analytics.trackEvent(event)
}
