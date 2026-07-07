import { execFileSync } from 'node:child_process'
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
} from './git.js'
import { buildToolBridge } from './tools.js'
import { runDocsCheck } from './validate.js'
import { runAgentLoop, type AnthropicLike } from './agent.js'
import { loadAgentsGuidance } from './config.js'
import { buildSystemPrompt, buildUserPrompt, buildRepairPrompt } from './prompt.js'
import type { DocsTask, AgentOptions, AgentResult } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-5'

/**
 * Run a docs task end-to-end on a **git sandbox branch**: assert a clean repo,
 * branch off HEAD, let the agent mutate the tree, self-validate (one repair
 * round), then honor the output mode — dry-run discards, write leaves the branch
 * dirty for review, pr commits + opens a PR.
 */
export async function runAgent(client: AnthropicLike, task: DocsTask, options: AgentOptions): Promise<AgentResult> {
  const { projectDir, mode } = options
  const model = options.model ?? process.env.DOX_AGENT_MODEL ?? DEFAULT_MODEL
  const maxSteps = options.maxSteps ?? 24
  const emit = options.onEvent ?? (() => {})

  assertCleanGitRepo(projectDir)
  const original = currentBranch(projectDir)
  const branch = `dox/agent-${Date.now().toString(36)}`
  createBranch(projectDir, branch)

  const restore = () => {
    try {
      hardReset(projectDir)
    } catch {
      /* ignore */
    }
    try {
      checkoutBranch(projectDir, original)
    } catch {
      /* ignore */
    }
    try {
      deleteBranch(projectDir, branch)
    } catch {
      /* ignore */
    }
  }

  try {
    const { claudeTools, dispatch } = buildToolBridge(projectDir)
    const system = buildSystemPrompt(loadAgentsGuidance(projectDir))

    emit('Drafting documentation…')
    const first = await runAgentLoop({
      client,
      model,
      maxSteps,
      system,
      userPrompt: buildUserPrompt(task),
      tools: claudeTools,
      dispatch,
      onEvent: (e) => emit(`  → ${e}`),
    })
    let summary = first.summary
    let steps = first.steps

    if (!hasChanges(projectDir)) {
      restore()
      return { branch, summary, steps, diff: '', validation: { ok: true, errors: [], warnings: [] }, noChanges: true }
    }

    // Self-validate against the workspace `dox check`; one repair round on failure.
    let validation = runDocsCheck(projectDir)
    if (!validation.ok) {
      emit('Validation failed — attempting a repair…')
      const repair = await runAgentLoop({
        client,
        model,
        maxSteps,
        system,
        userPrompt: buildRepairPrompt(validation.errors),
        tools: claudeTools,
        dispatch,
        onEvent: (e) => emit(`  → ${e}`),
      })
      if (repair.summary) summary = repair.summary
      steps += repair.steps
      validation = runDocsCheck(projectDir)
    }

    const diff = stagedDiff(projectDir)

    if (mode === 'dry-run') {
      restore()
      return { branch, summary, steps, diff, validation, noChanges: false }
    }

    if (mode === 'pr') {
      const title = `docs: ${task.instruction.slice(0, 60)}`
      const body = `${summary}\n\n---\n${task.requester ? `Requested by ${task.requester}. ` : ''}Drafted by the Dox docs agent — please review.`
      commitAll(projectDir, title)
      push(projectDir, branch)
      let prUrl: string
      try {
        prUrl = execFileSync('gh', ['pr', 'create', '--title', title, '--body', body, '--head', branch], {
          cwd: projectDir,
          encoding: 'utf8',
        }).trim()
      } catch (err) {
        throw new Error(
          `Changes committed and pushed to "${branch}", but opening the PR failed (is gh authenticated?): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      return { branch, summary, steps, diff, validation, prUrl, noChanges: false }
    }

    // mode === 'write': leave the edits staged on the agent branch for review.
    return { branch, summary, steps, diff, validation, noChanges: false }
  } catch (err) {
    restore()
    throw err
  }
}
