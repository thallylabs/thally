import type { ParsedArgs } from '../router.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  runAgent,
  resolveDiff,
  resolvePrContext,
  scaffoldAgentWorkflow,
  type AnthropicLike,
  type DocsTask,
  type OutputMode,
} from '@doxlabs/agent'

/** `dox agent init` — scaffold the docs-repo workflow + print the product-repo sender. */
function runAgentInit(args: ParsedArgs): number {
  const docsRepo = args.getFlag('--repo') ?? '<owner>/<docs-repo>'
  const { written, senderSnippet } = scaffoldAgentWorkflow(process.cwd(), docsRepo)
  for (const file of written) process.stdout.write(`\n  ✓ Wrote ${file}`)
  process.stdout.write('\n')
  process.stdout.write('\n  Add two secrets to THIS docs repo:\n')
  process.stdout.write('    - ANTHROPIC_API_KEY   (runs the agent)\n')
  process.stdout.write('    - DOX_AGENT_TOKEN     (fine-grained PAT/App: write here, read on product repos)\n')
  process.stdout.write('\n  Then in each PRODUCT repo, add .github/workflows/dox-mention.yml:\n\n')
  process.stdout.write(
    senderSnippet
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  )
  process.stdout.write('\n  …and a DOX_DISPATCH_TOKEN secret there (dispatch access to this docs repo).\n\n')
  return 0
}

/**
 * `dox agent "<instruction>" [--diff <ref>] [--from-pr <url>] [--dry-run] [--pr]`
 *
 * Turns a task into documentation edits on a git sandbox branch. Default leaves
 * the edits on the branch for review; --dry-run previews and discards; --pr opens
 * a pull request.
 */
export async function runAgentCommand(args: ParsedArgs): Promise<number> {
  if (args.positionals[0] === 'init') return runAgentInit(args)

  const instruction = args.positionals.join(' ').trim()
  const fromPr = args.getFlag('--from-pr')
  const diffRef = args.getFlag('--diff')

  if (!instruction && !fromPr) {
    process.stderr.write(
      '\n  Usage: dox agent "<what to document>" [--diff <ref>] [--from-pr <url>] [--dry-run] [--pr]\n\n',
    )
    return 1
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    process.stderr.write('\n  Set ANTHROPIC_API_KEY to run the docs agent.\n\n')
    return 1
  }

  let context = ''
  try {
    if (fromPr) context = resolvePrContext(fromPr)
    else if (diffRef) context = resolveDiff(process.cwd(), diffRef)
  } catch (err) {
    process.stderr.write(`\n  ${err instanceof Error ? err.message : String(err)}\n\n`)
    return 1
  }

  const mode: OutputMode = args.hasFlag('--dry-run') ? 'dry-run' : args.hasFlag('--pr') ? 'pr' : 'write'
  const task: DocsTask = {
    instruction: instruction || `Document the changes described in ${fromPr}`,
    context: context || undefined,
    source: 'cli',
  }

  const real = new Anthropic({ apiKey })
  const client: AnthropicLike = {
    messages: { create: (body) => real.messages.create(body as never) as never },
  }

  process.stdout.write(`\n  🤖 Dox docs agent — ${mode}\n\n`)
  try {
    const result = await runAgent(client, task, {
      projectDir: process.cwd(),
      mode,
      onEvent: (event) => process.stdout.write(`  ${event}\n`),
    })

    if (result.noChanges) {
      process.stdout.write('\n  No documentation changes were needed.\n\n')
      return 0
    }

    const v = result.validation
    process.stdout.write(`\n  ${result.summary}\n`)
    process.stdout.write(
      `\n  Validation: ${v.ok ? '✓ passed' : `✗ ${v.errors.length} error(s)`}${v.warnings.length ? ` · ${v.warnings.length} warning(s)` : ''}\n`,
    )

    if (mode === 'dry-run') {
      process.stdout.write(`\n${result.diff}\n  (dry run — nothing was written)\n\n`)
    } else if (mode === 'pr' && result.prUrl) {
      process.stdout.write(`\n  Pull request: ${result.prUrl}\n\n`)
    } else {
      process.stdout.write(`\n  Edits are on branch "${result.branch}" — review, then commit or open a PR.\n\n`)
    }
    return v.ok ? 0 : 1
  } catch (err) {
    process.stderr.write(`\n  Agent failed: ${err instanceof Error ? err.message : String(err)}\n\n`)
    return 1
  }
}
