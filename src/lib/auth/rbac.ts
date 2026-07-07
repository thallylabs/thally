import type { NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/auth/session'
import { resolveRoleFromRoster } from '@/lib/auth/roster'
import { isAdminAuthenticated, ADMIN_SESSION_COOKIE } from '@/lib/admin/auth'
import { getTeamConfig } from '@/data/docs'
import { getAdminSettings } from '@/lib/admin/settings'
import { roleAllows, type Capability, type Role } from '@/lib/auth/types'

export interface AdminSession {
  email: string
  role: Role
}

/**
 * A member's current role — resolved LIVE on every request (never trusted from
 * the cookie): the git-committed roster PLUS any admin-added domains from
 * settings. Remove/downgrade someone and their next request reflects it.
 */
export async function resolveRole(email: string): Promise<Role | null> {
  const team = getTeamConfig()
  let extraDomains: typeof team.domains = []
  try {
    extraDomains = (await getAdminSettings()).allowedDomains
  } catch {
    // settings store unavailable — fall back to the git roster only
  }
  return resolveRoleFromRoster(email, { members: team.members, domains: [...team.domains, ...extraDomains] })
}

/**
 * Turn a session cookie into an authorized admin: verify the signature
 * (identity), then resolve the role live from the roster. Null when the cookie
 * is invalid or the identity is no longer in the roster. Server-side only.
 */
export async function resolveAdminSession(token: string | undefined): Promise<AdminSession | null> {
  const session = await verifySession(token)
  if (!session) return null
  const role = await resolveRole(session.email)
  return role ? { email: session.email, role } : null
}

/** Resolve the session and require a capability; null if unauthenticated or unauthorized. */
export async function requireCapability(
  token: string | undefined,
  capability: Capability,
): Promise<AdminSession | null> {
  const session = await resolveAdminSession(token)
  if (!session) return null
  return roleAllows(session.role, capability) ? session : null
}

/**
 * Resolve the admin from a request: an OIDC identity (→ live roster role), or the
 * break-glass DOX_ADMIN_PASSWORD session (→ Owner, since the password-holder is
 * the deployer). Node-only (reaches the roster).
 */
export async function resolveAdminFromRequest(request: NextRequest): Promise<AdminSession | null> {
  const oidc = await resolveAdminSession(request.cookies.get(SESSION_COOKIE)?.value)
  if (oidc) return oidc
  if (isAdminAuthenticated(request)) return { email: 'break-glass', role: 'owner' }
  return null
}

/** Require a capability from a request; null if unauthenticated or unauthorized. */
export async function requireCapabilityFromRequest(
  request: NextRequest,
  capability: Capability,
): Promise<AdminSession | null> {
  const session = await resolveAdminFromRequest(request)
  if (!session) return null
  return roleAllows(session.role, capability) ? session : null
}
