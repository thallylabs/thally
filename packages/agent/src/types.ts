/** Where a docs task came from. */
export type TaskSource = 'cli' | 'mention' | 'merge' | 'drift' | 'track'

/**
 * The unit of work for the agent. Every trigger surface (the CLI, a `@thally`
 * comment, a merge dispatch, a drift sweep) produces one of these; the agent
 * consumes it the same way regardless of origin.
 */
export interface DocsTask {
  /** What to do, in prose. */
  instruction: string
  /** Resolved context the agent should read before drafting (PR body, diff, issues). */
  context?: string
  /** Who asked, for attribution in the PR. */
  requester?: string
  source: TaskSource
}

export type OutputMode = 'dry-run' | 'write' | 'pr'

export interface AgentOptions {
  /** The docs project directory (must be a clean git repo). */
  projectDir: string
  mode: OutputMode
  model?: string
  maxSteps?: number
  /** Progress callback (tool calls, phases). */
  onEvent?: (event: string) => void
}

export interface AgentResult {
  /** The branch the agent worked on. */
  branch: string
  /** The agent's prose summary of what it changed. */
  summary: string
  steps: number
  /** Unified diff of the changes (populated for dry-run and before a PR). */
  diff: string
  /** Validation outcome after edits (and any repair round). */
  validation: { ok: boolean; errors: Array<string>; warnings: Array<string> }
  /** PR URL, when mode === 'pr'. */
  prUrl?: string
  /** True when nothing was changed. */
  noChanges: boolean
}
