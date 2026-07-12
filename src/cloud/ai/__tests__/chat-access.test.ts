import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveAnthropicKey,
  checkChatRateLimit,
  __resetChatRateLimit,
} from '@/cloud/ai/chat-access'

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'THALLY_TRIAL_ANTHROPIC_KEY',
  'THALLY_CHAT_RATE_PER_MIN',
  'THALLY_CHAT_RATE_PER_DAY',
  'THALLY_TRIAL_RATE_PER_MIN',
  'THALLY_TRIAL_RATE_PER_DAY',
  'THALLY_TRIAL_DAILY_LIMIT',
  // Legacy fallback names — cleared too so an ambient DOX_* value can't leak in.
  'DOX_TRIAL_ANTHROPIC_KEY',
  'DOX_CHAT_RATE_PER_MIN',
  'DOX_CHAT_RATE_PER_DAY',
  'DOX_TRIAL_RATE_PER_MIN',
  'DOX_TRIAL_RATE_PER_DAY',
  'DOX_TRIAL_DAILY_LIMIT',
] as const

describe('resolveAnthropicKey', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k]
      delete process.env[k]
    })
  })

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    })
  })

  it('returns null when no key is configured', () => {
    expect(resolveAnthropicKey()).toBeNull()
  })

  it('prefers the owner key', () => {
    process.env.ANTHROPIC_API_KEY = 'owner-key'
    process.env.THALLY_TRIAL_ANTHROPIC_KEY = 'trial-key'
    expect(resolveAnthropicKey()).toEqual({ apiKey: 'owner-key', tier: 'owner' })
  })

  it('falls back to the trial key', () => {
    process.env.THALLY_TRIAL_ANTHROPIC_KEY = 'trial-key'
    expect(resolveAnthropicKey()).toEqual({ apiKey: 'trial-key', tier: 'trial' })
  })
})

describe('checkChatRateLimit', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k]
      delete process.env[k]
    })
    __resetChatRateLimit()
  })

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    })
    vi.useRealTimers()
  })

  it('caps the trial tier tightly per minute', () => {
    process.env.THALLY_TRIAL_RATE_PER_MIN = '5'
    const now = 1_000_000
    for (let i = 0; i < 5; i += 1) {
      expect(checkChatRateLimit('1.1.1.1', 'trial', now).limited).toBe(false)
    }
    const blocked = checkChatRateLimit('1.1.1.1', 'trial', now)
    expect(blocked.limited).toBe(true)
    expect(blocked.reason).toBe('per_minute')
  })

  it('lets the owner tier run far higher than trial', () => {
    process.env.THALLY_CHAT_RATE_PER_MIN = '20'
    const now = 2_000_000
    for (let i = 0; i < 20; i += 1) {
      expect(checkChatRateLimit('2.2.2.2', 'owner', now).limited).toBe(false)
    }
    expect(checkChatRateLimit('2.2.2.2', 'owner', now).limited).toBe(true)
  })

  it('enforces a global daily ceiling on the shared trial key', () => {
    process.env.THALLY_TRIAL_RATE_PER_MIN = '1000'
    process.env.THALLY_TRIAL_RATE_PER_DAY = '0'
    process.env.THALLY_TRIAL_DAILY_LIMIT = '3'
    const now = 3_000_000
    expect(checkChatRateLimit('a', 'trial', now).limited).toBe(false)
    expect(checkChatRateLimit('b', 'trial', now).limited).toBe(false)
    expect(checkChatRateLimit('c', 'trial', now).limited).toBe(false)
    const blocked = checkChatRateLimit('d', 'trial', now)
    expect(blocked.limited).toBe(true)
    expect(blocked.reason).toBe('global_daily')
  })

  it('does not apply the global ceiling to the owner tier', () => {
    process.env.THALLY_CHAT_RATE_PER_MIN = '1000'
    process.env.THALLY_TRIAL_DAILY_LIMIT = '1'
    const now = 4_000_000
    for (let i = 0; i < 50; i += 1) {
      expect(checkChatRateLimit(`ip-${i}`, 'owner', now).limited).toBe(false)
    }
  })

  it('resets the per-minute window after it elapses', () => {
    process.env.THALLY_TRIAL_RATE_PER_MIN = '1'
    const start = 5_000_000
    expect(checkChatRateLimit('x', 'trial', start).limited).toBe(false)
    expect(checkChatRateLimit('x', 'trial', start).limited).toBe(true)
    expect(checkChatRateLimit('x', 'trial', start + 61_000).limited).toBe(false)
  })
})
