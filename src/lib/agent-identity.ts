/**
 * Stable, customer-specific identifiers for machine discovery surfaces.
 *
 * Protocol clients cache these names, so normalization must stay deterministic
 * while never falling back to a platform baseline or another tenant.
 */

/** Convert a display name into a safe local identifier for agent clients. */
export function agentIdentitySlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'documentation'
  )
}

/** MCP server identifier advertised by discovery and initialize responses. */
export function agentServerName(name: string): string {
  return `${agentIdentitySlug(name)}-docs`
}
