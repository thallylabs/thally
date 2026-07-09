import { helpText, parseArgs } from './router.js'
import { isDoxProject, runFramework, runPackageBin } from './process.js'
import { runNewPage } from './commands/new-page.js'
import { runCheck } from './commands/check.js'
import { runDeploy } from './commands/deploy.js'
import { runAgentCommand } from './commands/agent.js'
import { runTrackCommand } from './commands/track.js'

const [major] = process.versions.node.split('.').map(Number)
if (major < 18) {
  process.stderr.write('Error: dox requires Node.js >= 18\n')
  process.exit(1)
}

function requireProject(): void {
  if (!isDoxProject()) {
    process.stderr.write('\n  Not a Dox project (no docs.json here). Run "dox init" to scaffold one.\n\n')
    process.exit(1)
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  if (!args.command || args.command === 'help') {
    process.stdout.write(helpText())
    return 0
  }

  switch (args.command) {
    case 'init':
    case 'create':
      return runPackageBin('create-dox', 'create-dox', args.rest)

    case 'dev':
      requireProject()
      return runFramework('dev', 'dev', args.positionals)

    case 'build':
      requireProject()
      return runFramework('build', 'build')

    case 'start':
      requireProject()
      return runFramework('start', 'start')

    case 'deploy':
      requireProject()
      return runDeploy(args)

    case 'check':
      requireProject()
      return runCheck(args)

    case 'new':
      requireProject()
      return runNewPage(args)

    case 'migrate':
      return runPackageBin('create-dox', 'create-dox', ['migrate', ...args.rest])

    case 'translate':
      requireProject()
      return runPackageBin('create-dox', 'create-dox', ['translate', ...args.rest])

    case 'mcp':
      return runPackageBin('@doxlabs/mcp', 'dox-mcp', args.rest)

    case 'agent':
      requireProject()
      return runAgentCommand(args)

    case 'track':
      requireProject()
      return runTrackCommand(args)

    default:
      process.stderr.write(`\n  Unknown command: ${args.command}\n`)
      process.stdout.write(helpText())
      return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
