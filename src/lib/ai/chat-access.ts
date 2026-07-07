/**
 * Anthropic key tiering for the AI chat.
 *
 * The goal is a frictionless "aha" experience: every Dox project can answer a
 * few questions out of the box using a shared, tightly rate-limited trial key.
 * Once owners want real usage, they drop in their own key and the trial limits
 * fall away.
 *
 * Key precedence:
 *   1. ANTHROPIC_API_KEY        -> owner tier  (their key, generous limits)
 *   2. DOX_TRIAL_ANTHROPIC_KEY  -> trial tier  (shared key, strict limits + global cap)
 *   3. none                     -> chat disabled (caller returns 503)
 *
 * Limits are per-IP (sliding windows) plus, for the trial tier only, a global
 * daily ceiling that protects the shared key from a single noisy deployment.
 *
 * NOTE: counters are in-memory and therefore per-instance. On serverless this
 * is a soft limit, not a billing guarantee — a durable counter (libSQL/Turso)
 * is tracked separately on the roadmap. The trial key should also carry a hard
 * spend cap configured at the Anthropic account level.
 */

export type AiKeyTier = 'owner' | 'trial'

export interface ResolvedAiKey {
  apiKey: string
  tier: AiKeyTier
}

export interface RateLimitDecision {
  limited: boolean
  /** Seconds until the relevant window resets (best effort). */
  retryAfter?: number
  reason?: 'per_minute' | 'per_day' | 'global_daily'
}

interface TierLimit {
  /** Requests per rolling minute, per IP. 0 disables the check. */
  perMinute: number
  /** Requests per rolling day, per IP. 0 disables the check. */
  perDay: number
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function resolveAnthropicKey(): ResolvedAiKey | null {
  const ownerKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (ownerKey) return { apiKey: ownerKey, tier: 'owner' }

  const trialKey = process.env.DOX_TRIAL_ANTHROPIC_KEY?.trim()
  if (trialKey) return { apiKey: trialKey, tier: 'trial' }

  return null
}

/**
 * Resolve the chat key with the admin override applied: a dashboard-set key
 * (F1, encrypted) is used first at OWNER tier; otherwise fall back to the env
 * resolver. Decrypt failure (e.g. rotated DOX_AUTH_SECRET) degrades to env.
 */
export async function resolveChatKey(): Promise<ResolvedAiKey | null> {
  try {
    const { getAdminSettings } = await import('@/lib/admin/settings')
    const { decryptSecret } = await import('@/lib/admin/secrets')
    const { chatKeyEnc } = await getAdminSettings()
    if (chatKeyEnc) {
      const apiKey = decryptSecret(chatKeyEnc)
      if (apiKey) return { apiKey, tier: 'owner' }
    }
  } catch {
    // fall through to the env resolver
  }
  return resolveAnthropicKey()
}

function tierLimits(tier: AiKeyTier): TierLimit {
  if (tier === 'owner') {
    return {
      perMinute: envInt('DOX_CHAT_RATE_PER_MIN', 20),
      perDay: envInt('DOX_CHAT_RATE_PER_DAY', 0),
    }
  }
  return {
    perMinute: envInt('DOX_TRIAL_RATE_PER_MIN', 5),
    perDay: envInt('DOX_TRIAL_RATE_PER_DAY', 30),
  }
}

function trialGlobalDailyLimit(): number {
  return envInt('DOX_TRIAL_DAILY_LIMIT', 500)
}

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60 * 1000

interface WindowCounter {
  count: number
  resetAt: number
}

const perMinuteByIp = new Map<string, WindowCounter>()
const perDayByIp = new Map<string, WindowCounter>()
let globalDay: WindowCounter = { count: 0, resetAt: 0 }

function hit(store: Map<string, WindowCounter>, key: string, limit: number, windowMs: number, now: number): RateLimitDecision | null {
  if (limit <= 0) return null
  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return null
  }
  if (entry.count >= limit) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) }
  }
  entry.count += 1
  return null
}

/**
 * Records a request against the relevant windows and reports whether it should
 * be rejected. Call exactly once per accepted request.
 */
export function checkChatRateLimit(ip: string, tier: AiKeyTier, now: number = Date.now()): RateLimitDecision {
  const limits = tierLimits(tier)

  const minuteHit = hit(perMinuteByIp, `${tier}:${ip}`, limits.perMinute, MINUTE_MS, now)
  if (minuteHit) return { ...minuteHit, reason: 'per_minute' }

  const dayHit = hit(perDayByIp, `${tier}:${ip}`, limits.perDay, DAY_MS, now)
  if (dayHit) return { ...dayHit, reason: 'per_day' }

  if (tier === 'trial') {
    const globalLimit = trialGlobalDailyLimit()
    if (globalLimit > 0) {
      if (now > globalDay.resetAt) {
        globalDay = { count: 1, resetAt: now + DAY_MS }
      } else if (globalDay.count >= globalLimit) {
        return {
          limited: true,
          reason: 'global_daily',
          retryAfter: Math.max(1, Math.ceil((globalDay.resetAt - now) / 1000)),
        }
      } else {
        globalDay.count += 1
      }
    }
  }

  return { limited: false }
}

/** Test-only: clear all counters. */
export function __resetChatRateLimit(): void {
  perMinuteByIp.clear()
  perDayByIp.clear()
  globalDay = { count: 0, resetAt: 0 }
}
