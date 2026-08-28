import { execFileSync } from "node:child_process";
import {
  assertCleanGitRepo,
  currentBranch,
  createBranch,
  checkoutBranch,
  deleteBranch,
  stagedDiff,
  hardReset,
  commitAll,
  push,
  hasChanges,
} from "./git.js";
import { buildToolBridge } from "./tools.js";
import { runDocsCheck } from "./validate.js";
import {
  runAgentLoop,
  TRACK_AGENT_MAX_TOTAL_STEPS,
  type AgentTerminalProfile,
  type AnthropicLike,
} from "./agent.js";
import {
  loadSystemPromptAgentsGuidance,
  type AgentExecutionAuthority,
} from "./config.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
  buildAbstentionRepairPrompt,
} from "./prompt.js";
import { resolveAgentModel } from "./model.js";
import { assertAgentWritePolicySatisfied } from "./write-policy.js";
import type { DocsTask, AgentOptions, AgentResult } from "./types.js";

/** Keep repository-authored instructions out of every Track or sealed run. */
export function resolveAgentExecutionAuthority(
  taskSource: DocsTask["source"],
  hasWritePolicy: boolean,
): AgentExecutionAuthority {
  return taskSource === "cli" && !hasWritePolicy
    ? "trusted-local"
    : "sealed-controller";
}

export interface AgentPromptEnvelope {
  system: string;
  userPrompt: string;
}

interface AgentTurnResult {
  steps: number;
}

export interface AgentTurnBudget {
  run<T extends AgentTurnResult>(
    execute: (maximumSteps: number) => Promise<T>,
  ): Promise<T>;
}

/**
 * Share one controller-owned turn allowance across otherwise independent model
 * loops. Generic callers omit `maximumTotalSteps` and retain their historical
 * per-loop behavior.
 */
export function createAgentTurnBudget(
  maximumStepsPerLoop: number,
  maximumTotalSteps?: number,
): AgentTurnBudget {
  let remainingSteps = maximumTotalSteps;
  return {
    async run<T extends AgentTurnResult>(
      execute: (maximumSteps: number) => Promise<T>,
    ): Promise<T> {
      if (remainingSteps !== undefined && remainingSteps < 1) {
        throw new Error("agent_total_step_limit_exceeded");
      }
      const admittedSteps =
        remainingSteps === undefined
          ? maximumStepsPerLoop
          : Math.min(maximumStepsPerLoop, remainingSteps);
      const result = await execute(admittedSteps);
      if (
        remainingSteps !== undefined &&
        (!Number.isSafeInteger(result.steps) ||
          result.steps < 0 ||
          result.steps > admittedSteps)
      ) {
        throw new Error("agent_step_accounting_invalid");
      }
      if (remainingSteps !== undefined) remainingSteps -= result.steps;
      return result;
    },
  };
}

/**
 * Resolve the first model-loop allowance for one execution authority.
 *
 * Policy-bound Track sessions persist one 32-turn capability. Their initial
 * loop must be allowed to consume that same ceiling; otherwise the public
 * agent can stop at its historical 24-turn CLI default while the durable
 * session still has valid unused authority.
 */
export function resolveAgentLoopMaximumSteps(
  requestedMaximumSteps: number | undefined,
  hasWritePolicy: boolean,
): number {
  const defaultMaximumSteps = hasWritePolicy
    ? TRACK_AGENT_MAX_TOTAL_STEPS
    : 24;
  const maximumSteps = requestedMaximumSteps ?? defaultMaximumSteps;
  return hasWritePolicy
    ? Math.min(maximumSteps, TRACK_AGENT_MAX_TOTAL_STEPS)
    : maximumSteps;
}

/** Build the exact prompt roles used by initial and repair model turns. */
export function buildAgentPromptEnvelope(
  projectDir: string,
  task: DocsTask,
  hasWritePolicy: boolean,
): AgentPromptEnvelope {
  const authority = resolveAgentExecutionAuthority(task.source, hasWritePolicy);
  return {
    system: buildSystemPrompt(
      loadSystemPromptAgentsGuidance(projectDir, authority),
    ),
    userPrompt: buildUserPrompt(task),
  };
}

/** Reconcile the model's terminal claim with the repository state it left behind. */
export function assertDocumentationDecisionMatchesState(
  decision: AgentResult["decision"],
  hasRepositoryChanges: boolean,
): void {
  if (
    (hasRepositoryChanges && decision.outcome !== "drafted") ||
    (!hasRepositoryChanges && decision.outcome !== "abstained")
  ) {
    throw new Error("agent_result_invalid");
  }
}

/** A clean repair is a valid abstention only after its final docs check passes. */
export function assertCleanDocumentationResultIsValid(
  validation: AgentResult["validation"],
): void {
  if (!validation.ok) throw new Error("agent_validation_failed");
}

/** Keep generated documentation PRs based on the branch the agent checked out. */
export function buildPullRequestCreateArgs(
  title: string,
  body: string,
  branch: string,
  baseBranch: string,
): Array<string> {
  return [
    "pr",
    "create",
    "--title",
    title,
    "--body",
    body,
    "--head",
    branch,
    "--base",
    baseBranch,
  ];
}

/** Build a single-line conventional title that stays within GitHub's readable subject length. */
export function buildPullRequestTitle(instruction: string): string {
  const normalizedInstruction = instruction.replace(/\s+/g, " ").trim();
  if (!normalizedInstruction) return "docs: update documentation";
  const maxSummaryLength = 65;
  const summary =
    normalizedInstruction.length > maxSummaryLength
      ? `${normalizedInstruction.slice(0, maxSummaryLength).trimEnd()}…`
      : normalizedInstruction;
  return `docs: ${summary}`;
}

/**
 * Run a docs task end-to-end on a **git sandbox branch**: assert a clean repo,
 * branch off HEAD, let the agent mutate the tree, self-validate (one repair
 * round), then honor the output mode — dry-run discards, write leaves the branch
 * dirty for review, pr commits + opens a PR.
 */
export async function runAgent(
  client: AnthropicLike,
  task: DocsTask,
  options: AgentOptions,
): Promise<AgentResult> {
  const { projectDir, mode } = options;
  const model = resolveAgentModel(options.model);
  const maxSteps = resolveAgentLoopMaximumSteps(
    options.maxSteps,
    Boolean(options.writePolicy),
  );
  const emit = options.onEvent ?? (() => {});

  assertCleanGitRepo(projectDir);
  const original = currentBranch(projectDir);
  const branch = `thally/agent-${Date.now().toString(36)}`;
  createBranch(projectDir, branch);

  const restore = () => {
    try {
      hardReset(projectDir);
    } catch {
      /* ignore */
    }
    try {
      checkoutBranch(projectDir, original);
    } catch {
      /* ignore */
    }
    try {
      deleteBranch(projectDir, branch);
    } catch {
      /* ignore */
    }
  };

  try {
    const { claudeTools, dispatch } = buildToolBridge(projectDir, {
      writePolicy: options.writePolicy,
    });
    const { system, userPrompt: taskPrompt } = buildAgentPromptEnvelope(
      projectDir,
      task,
      Boolean(options.writePolicy),
    );
    const terminalProfile: AgentTerminalProfile = options.writePolicy
      ? "policy-bound"
      : "generic";
    const turnBudget = createAgentTurnBudget(
      maxSteps,
      options.writePolicy ? TRACK_AGENT_MAX_TOTAL_STEPS : undefined,
    );
    // Every turn in one run must share the same terminal authority. Keeping
    // this wrapper as the only loop entrypoint prevents repair rounds from
    // silently falling back to the generic, claim-optional contract.
    const runTurn = (userPrompt: string) =>
      turnBudget.run((maximumSteps) =>
        runAgentLoop({
          client,
          model,
          maxSteps: maximumSteps,
          system,
          userPrompt,
          tools: claudeTools,
          maximumRequestBytes: options.maximumRequestBytes,
          maximumOutputTokens: options.maximumOutputTokens,
          terminalProfile,
          dispatch,
          onEvent: (event) => emit(`  → ${event}`),
        }),
      );

    emit("Drafting documentation…");
    const first = await runTurn(taskPrompt);
    let summary = first.summary;
    let steps = first.steps;
    let decision = first.decision;

    if (!hasChanges(projectDir) && options.requireChanges) {
      emit("No documentation diff — attempting one grounded repair…");
      const retry = await runTurn(
        `${taskPrompt}\n\n${buildAbstentionRepairPrompt(decision)}`,
      );
      summary = retry.summary || summary;
      steps += retry.steps;
      decision = retry.decision;
    }

    if (!hasChanges(projectDir)) {
      assertDocumentationDecisionMatchesState(decision, false);
      if (options.writePolicy) {
        assertAgentWritePolicySatisfied(
          projectDir,
          options.writePolicy,
          decision,
        );
      }
      restore();
      return {
        branch,
        summary,
        steps,
        diff: "",
        validation: { ok: true, errors: [], warnings: [] },
        noChanges: true,
        decision,
      };
    }
    assertDocumentationDecisionMatchesState(decision, true);

    // Self-validate against the workspace `thally check`; one repair round on failure.
    let validation = runDocsCheck(projectDir);
    if (!validation.ok) {
      emit("Validation failed — attempting a repair…");
      const repair = await runTurn(
        `${taskPrompt}\n\n${buildRepairPrompt(validation.errors)}`,
      );
      if (repair.summary) summary = repair.summary;
      steps += repair.steps;
      decision = repair.decision;
      validation = runDocsCheck(projectDir);
    }

    // A repair may remove every rejected edit. Re-read git state instead of
    // carrying the pre-validation dirty bit forward, then preserve the same
    // drafted/dirty and abstained/clean contract used by the initial pass.
    const hasFinalChanges = hasChanges(projectDir);
    assertDocumentationDecisionMatchesState(decision, hasFinalChanges);
    if (!hasFinalChanges) {
      assertCleanDocumentationResultIsValid(validation);
      if (options.writePolicy) {
        assertAgentWritePolicySatisfied(
          projectDir,
          options.writePolicy,
          decision,
        );
      }
      restore();
      return {
        branch,
        summary,
        steps,
        diff: "",
        validation,
        noChanges: true,
        decision,
      };
    }

    if (options.writePolicy) {
      assertAgentWritePolicySatisfied(
        projectDir,
        options.writePolicy,
        decision,
      );
    }
    const diff = stagedDiff(projectDir);

    if (mode === "dry-run") {
      restore();
      return {
        branch,
        summary,
        steps,
        diff,
        validation,
        noChanges: false,
        decision,
      };
    }

    if (mode === "pr") {
      const title = buildPullRequestTitle(task.instruction);
      // The `(origin: …)` marker is parsed by the admin task queue (src/lib/tasks.ts
      // parseOrigin) — keep it, and keep "Thally docs agent" (the queue's filter).
      const body = `${summary}\n\n---\n${task.requester ? `Requested by ${task.requester}. ` : ""}Drafted by the Thally docs agent (origin: ${task.source}) — please review.`;
      commitAll(projectDir, title);
      push(projectDir, branch);
      let prUrl: string;
      try {
        prUrl = execFileSync(
          "gh",
          buildPullRequestCreateArgs(title, body, branch, original),
          {
            cwd: projectDir,
            encoding: "utf8",
          },
        ).trim();
      } catch (err) {
        throw new Error(
          `Changes committed and pushed to "${branch}", but opening the PR failed (is gh authenticated?): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return {
        branch,
        summary,
        steps,
        diff,
        validation,
        prUrl,
        noChanges: false,
        decision,
      };
    }

    // mode === 'write': leave the edits staged on the agent branch for review.
    return {
      branch,
      summary,
      steps,
      diff,
      validation,
      noChanges: false,
      decision,
    };
  } catch (err) {
    restore();
    throw err;
  }
}
