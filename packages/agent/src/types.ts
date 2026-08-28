import type { AgentWritePolicy } from "./write-policy.js";

/** Where a docs task came from. */
export type TaskSource = "cli" | "mention" | "merge" | "drift" | "track";

/**
 * The unit of work for the agent. Every trigger surface (the CLI, a `@thally`
 * comment, a merge dispatch, a drift sweep) produces one of these; the agent
 * consumes it the same way regardless of origin.
 */
export interface DocsTask {
  /** What to do, in prose. */
  instruction: string;
  /** Resolved context the agent should read before drafting (PR body, diff, issues). */
  context?: string;
  /** Who asked, for attribution in the PR. */
  requester?: string;
  source: TaskSource;
}

export type OutputMode = "dry-run" | "write" | "pr";

export interface AgentOptions {
  /** The docs project directory (must be a clean git repo). */
  projectDir: string;
  mode: OutputMode;
  model?: string;
  maxSteps?: number;
  /** Progress callback (tool calls, phases). */
  onEvent?: (event: string) => void;
  /** Give an evidence-backed task one clean retry before accepting abstention. */
  requireChanges?: boolean;
  /** Exact paths and change identifiers authorized by a sealed controller plan. */
  writePolicy?: Readonly<AgentWritePolicy>;
  /** Complete Anthropic JSON-body ceiling imposed by a managed Track gateway. */
  maximumRequestBytes?: number;
  /** Per-turn model-output budget; managed Track uses a larger bounded result profile. */
  maximumOutputTokens?: number;
}

export type DocumentationAbstentionReason =
  | "already_documented"
  | "insufficient_evidence"
  | "internal_only"
  | "unsupported_destination";

/**
 * Model-declared evidence coverage for one factual span in a drafted file.
 *
 * Track verifies these coordinates against the final Git diff and sealed
 * evidence authority before the draft may leave its sandbox. Other callers
 * may omit the inventory when they do not provide evidence identifiers.
 */
export interface DocumentationFactualClaim {
  path: string;
  startLine: number;
  endLine: number;
  /** Exact sealed product-change identities supported by this span. */
  changeIds: Array<string>;
  evidenceReferenceIds: Array<string>;
}

export type DocumentationDecision =
  | {
      outcome: "drafted";
      explanation: string;
      inspectedPaths: Array<string>;
      changeIds: Array<string>;
      factualClaims?: Array<DocumentationFactualClaim>;
    }
  | {
      outcome: "abstained";
      reason: DocumentationAbstentionReason;
      explanation: string;
      inspectedPaths: Array<string>;
      changeIds: Array<string>;
    };

export interface AgentResult {
  /** The branch the agent worked on. */
  branch: string;
  /** The agent's prose summary of what it changed. */
  summary: string;
  steps: number;
  /** Unified diff of the changes (populated for dry-run and before a PR). */
  diff: string;
  /** Validation outcome after edits (and any repair round). */
  validation: { ok: boolean; errors: Array<string>; warnings: Array<string> };
  /** PR URL, when mode === 'pr'. */
  prUrl?: string;
  /** True when nothing was changed. */
  noChanges: boolean;
  /** Required terminal protocol; never inferred from prose or git state. */
  decision: DocumentationDecision;
}
