import { getTeamConfig, type TeamConfig } from '@/data/docs'
import type { Role } from '@/lib/auth/types'

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? email.slice(at + 1) : ''
}

/**
 * Resolve a **verified** email to a role from the git-committed roster. Explicit
 * `members` win over `domains` defaults; anyone unlisted gets no access.
 *
 * The email MUST come from a verified OIDC identity — a domain match is only
 * trustworthy for an address the IdP has vouched for.
 */
export function resolveRoleFromRoster(email: string, team: TeamConfig = getTeamConfig()): Role | null {
  const normalized = normalizeEmail(email)

  const explicit = team.members.find((m) => normalizeEmail(m.email) === normalized)
  if (explicit) return explicit.role

  const domain = domainOf(normalized)
  if (!domain) return null
  const byDomain = team.domains.find((d) => d.domain.trim().toLowerCase() === domain)
  return byDomain ? byDomain.role : null
}

/** Whether any team access is configured (members or domains). */
export function isTeamConfigured(team: TeamConfig = getTeamConfig()): boolean {
  return team.members.length > 0 || team.domains.length > 0
}
