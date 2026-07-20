/**
 * Resolve the Anthropic model used by documentation-agent runs.
 *
 * GitHub Actions exports unset repository variables as empty strings. Treat
 * those values as absent so optional configuration cannot suppress the safe
 * runtime default.
 */

export const DEFAULT_AGENT_MODEL = 'claude-sonnet-5'

function nonEmptyModel(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

/** Resolve explicit, current, and legacy configuration in precedence order. */
export function resolveAgentModel(
  explicitModel?: string,
  configuredModel = process.env.THALLY_AGENT_MODEL,
  legacyModel = process.env.DOX_AGENT_MODEL,
): string {
  return (
    nonEmptyModel(explicitModel) ??
    nonEmptyModel(configuredModel) ??
    nonEmptyModel(legacyModel) ??
    DEFAULT_AGENT_MODEL
  )
}
