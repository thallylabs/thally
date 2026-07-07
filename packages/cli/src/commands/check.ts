import type { ParsedArgs } from '../router.js'
import { projectScripts, run, runPackageBin } from '../process.js'

/**
 * Lint content (orphan pages, missing frontmatter) via create-dox, and — with
 * --agents — run the Agent Readiness Score from the same project script.
 */
export async function runCheck(args: ParsedArgs): Promise<number> {
  const contentArgs = ['check', '.']
  if (args.hasFlag('--fix')) contentArgs.push('--fix')
  if (args.hasFlag('--ci')) contentArgs.push('--ci')
  if (args.hasFlag('--external')) contentArgs.push('--external')
  if (args.hasFlag('--drift')) contentArgs.push('--drift')

  let exit = await runPackageBin('create-dox', 'create-dox', contentArgs)

  if (args.hasFlag('--agents')) {
    const scripts = projectScripts()
    if (scripts['check:agents']) {
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      const min = args.getFlag('--min')
      const agentsExit = await run(npm, ['run', 'check:agents', ...(min ? ['--', '--min', min] : [])])
      if (agentsExit !== 0) exit = agentsExit
    } else {
      process.stdout.write('\n  Agent Readiness check unavailable (no "check:agents" script in this project).\n\n')
    }
  }

  return exit
}
