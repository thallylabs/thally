/**
 * Admin-team RBAC (C1). This is about the **admin dashboard team** — the people
 * who manage docs, view analytics, and set the private-docs password — not about
 * gating docs for visitors (that's a simple shared password).
 *
 * The roster lives in the customer's own store (F1); identity is delegated to
 * their IdP (Google/Microsoft OIDC). Nothing is hosted by Thally → no per-seat cost.
 */

export type Role = 'owner' | 'editor' | 'viewer'

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
}

export interface Member {
  email: string
  role: Role
  status: 'active' | 'pending'
  /** Who invited this member (email), if applicable. */
  invitedBy?: string
  addedAt: number
}

/** Things a role can do in the admin dashboard. */
export type Capability =
  | 'view_analytics'
  | 'manage_docs'
  | 'set_docs_password'
  | 'run_agent'
  | 'manage_team'

const CAPABILITY_MIN_ROLE: Record<Capability, Role> = {
  view_analytics: 'viewer',
  manage_docs: 'editor',
  set_docs_password: 'editor',
  run_agent: 'editor',
  manage_team: 'owner',
}

/** Whether a role is allowed a capability (rank-based: owner ≥ editor ≥ viewer). */
export function roleAllows(role: Role, capability: Capability): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[CAPABILITY_MIN_ROLE[capability]]
}
