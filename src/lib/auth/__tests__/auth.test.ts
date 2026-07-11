import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The roster is read from docs.json via getTeamConfig — mock it (no real config).
vi.mock('@/data/docs', () => ({ getTeamConfig: vi.fn(() => ({ members: [], domains: [] })) }))

import { getTeamConfig } from '@/data/docs'
import { resolveRoleFromRoster, isTeamConfigured } from '@/lib/auth/roster'
import { resolveAdminSession, requireCapability } from '@/lib/auth/rbac'
import { signSession } from '@/lib/auth/session'

const team = {
  members: [
    { email: 'alice@acme.com', role: 'owner' as const },
    { email: 'Bob@Acme.com', role: 'editor' as const }, // mixed case on purpose
  ],
  domains: [{ domain: 'acme.com', role: 'viewer' as const }],
}

describe('resolveRoleFromRoster (git-committed roster)', () => {
  it('gives explicit members their role, case-insensitively', () => {
    expect(resolveRoleFromRoster('alice@acme.com', team)).toBe('owner')
    expect(resolveRoleFromRoster('bob@acme.com', team)).toBe('editor')
  })

  it('explicit member wins over the domain default', () => {
    // bob is an explicit editor, not the domain's viewer
    expect(resolveRoleFromRoster('BOB@acme.com', team)).toBe('editor')
  })

  it('falls back to the domain default for unlisted addresses', () => {
    expect(resolveRoleFromRoster('carol@acme.com', team)).toBe('viewer')
  })

  it('denies anyone outside the members and domains', () => {
    expect(resolveRoleFromRoster('mallory@evil.com', team)).toBeNull()
    expect(resolveRoleFromRoster('not-an-email', team)).toBeNull()
  })

  it('isTeamConfigured reflects whether any access is declared', () => {
    expect(isTeamConfigured(team)).toBe(true)
    expect(isTeamConfigured({ members: [], domains: [] })).toBe(false)
  })
})

describe('rbac — session → live role → capability', () => {
  beforeEach(() => {
    process.env.THALLY_AUTH_SECRET = 'test-secret-at-least-16-chars'
    vi.mocked(getTeamConfig).mockReturnValue(team)
  })
  afterEach(() => {
    delete process.env.THALLY_AUTH_SECRET
  })

  it('resolves the role, gates capabilities, and denies instantly when removed from the roster', async () => {
    const token = (await signSession({ email: 'bob@acme.com' }))!

    expect((await resolveAdminSession(token))?.role).toBe('editor')
    expect(await requireCapability(token, 'manage_docs')).not.toBeNull()
    expect(await requireCapability(token, 'manage_team')).toBeNull() // editor ≠ owner

    // Simulate a committed change that removes Bob → the same cookie is now denied.
    vi.mocked(getTeamConfig).mockReturnValue({ members: [{ email: 'alice@acme.com', role: 'owner' }], domains: [] })
    expect(await resolveAdminSession(token)).toBeNull()
  })
})
