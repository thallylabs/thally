/** Entry point for the public Thally command-line interface. */

import { createRequire } from 'node:module'
import { formatHelp, terminal } from 'create-thally-docs/terminal'
import { helpText, parseArgs } from './router.js'
import { isThallyProject, runFramework, runPackageBin } from './process.js'
import { runNewPage } from './commands/new-page.js'
import { runCheck } from './commands/check.js'
import { runDeploy } from './commands/deploy.js'
import { runAgentCommand } from './commands/agent.js'
import { runTrackCommand } from './commands/track.js'
import { runStarterCommand } from './commands/starter.js'

// Both src/ and dist/ sit one level below the package root, so the published
// package metadata is the single source of truth for version discovery.
const packageMetadata = createRequire(import.meta.url)('../package.json') as {
  version: string
}
const versionArguments = new Set(['--version', '-v', '-V', 'version'])

const [major] = process.versions.node.split('.').map(Number)
if (major < 18) {
  process.stderr.write('Error: thally requires Node.js >= 18\n')
  process.exit(1)
}

function requireProject(): void {
  if (!isThallyProject()) {
    terminal.error('Not a Thally project (no docs.json here). Run "thally init" to scaffold one.')
    process.exit(1)
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const args = parseArgs(argv)

  if (argv.length === 1 && versionArguments.has(argv[0])) {
    process.stdout.write(`${packageMetadata.version}\n`)
    return 0
  }

  if (argv.length === 0) {
    terminal.intro('Welcome', packageMetadata.version)
    terminal.section('Get started', [
      'thally init my-docs',
      'thally migrate <source-url> my-docs',
      'thally --help for all commands',
    ])
    return 0
  }

  if (!args.command || args.command === 'help') {
    process.stdout.write(formatHelp(helpText(packageMetadata.version)))
    return 0
  }

  // Scaffold and migration delegates own their presentation. Protocol and
  // machine-readable commands must never receive a decorative preamble.
  if (['dev', 'build', 'start', 'deploy', 'new'].includes(args.command)
    && !args.hasFlag('--json', '--machine', '--ci', '--help', '-h')
    && !process.env.CI) {
    terminal.intro(args.command, packageMetadata.version)
  }

  switch (args.command) {
    case 'init':
    case 'create':
      return runPackageBin('create-thally-docs', 'create-thally-docs', args.rest)

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
      return runPackageBin('create-thally-docs', 'create-thally-docs', ['migrate', ...args.rest])

    case 'translate':
      requireProject()
      return runPackageBin('create-thally-docs', 'create-thally-docs', ['translate', ...args.rest])

    case 'mcp':
      return runPackageBin('@thallylabs/mcp', 'thally-mcp', args.rest)

    case 'agent':
      requireProject()
      return runAgentCommand(args)

    case 'track':
      requireProject()
      return runTrackCommand(args)

    case 'starter':
      requireProject()
      return runStarterCommand(args)

    default:
      terminal.error(`Unknown command: ${args.command}`)
      process.stdout.write(formatHelp(helpText(packageMetadata.version)))
      return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    terminal.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
