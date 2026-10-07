/** Entry point for the public Thally command-line interface. */

import { createRequire } from 'node:module'
import { formatHelp, terminal } from 'create-thally-docs/terminal'
import { resolveInvocation } from './router.js'
import { hasInstalledDependencies, isThallyProject, runFramework, runPackageBin } from './process.js'
import { runDev } from './commands/dev.js'
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

/** Exit with guidance when the target directory is not a Thally project. */
function requireProject(directory = process.cwd()): void {
  if (!isThallyProject(directory)) {
    terminal.error('Not a Thally project (no docs.json here). Run "thally init" to scaffold one.')
    process.exit(1)
  }
}

/** Framework commands need the project's own Next.js install; say so plainly. */
function requireDependencies(command: string): void {
  if (!hasInstalledDependencies()) {
    terminal.error(`Dependencies are not installed. Run "npm install", then "thally ${command}" again.`)
    process.exit(1)
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)

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

  // Help and option errors are resolved before any project check, build, or
  // delegate starts, so informational calls can never have side effects.
  const invocation = resolveInvocation(argv, packageMetadata.version)
  if (invocation.kind === 'help') {
    process.stdout.write(formatHelp(invocation.text))
    return 0
  }
  if (invocation.kind === 'error') {
    terminal.error(invocation.message)
    if (invocation.usage) process.stdout.write(formatHelp(invocation.usage))
    return 1
  }
  const { command, args } = invocation
  const wantsDelegateHelp = args.hasFlag('--help', '-h')

  // Scaffold and migration delegates own their presentation. Protocol and
  // machine-readable commands must never receive a decorative preamble.
  if (['dev', 'build', 'start', 'deploy', 'new'].includes(command.name)
    && !args.hasFlag('--ci')
    && !process.env.CI) {
    terminal.intro(command.name, packageMetadata.version)
  }

  switch (command.name) {
    case 'init':
      return runPackageBin('create-thally-docs', 'create-thally-docs', args.rest)

    case 'dev':
      requireProject()
      requireDependencies('dev')
      return runDev(args)

    case 'build':
      requireProject()
      requireDependencies('build')
      return runFramework('build', 'build', args.passthrough)

    case 'start':
      requireProject()
      requireDependencies('start')
      return runFramework('start', 'start', args.passthrough)

    case 'deploy':
      requireProject()
      requireDependencies('deploy')
      return runDeploy(args)

    case 'check':
      requireProject(args.positionals[0] ?? process.cwd())
      return runCheck(args)

    case 'new':
      requireProject()
      return runNewPage(args)

    case 'migrate':
      return runPackageBin('create-thally-docs', 'create-thally-docs', ['migrate', ...args.rest])

    case 'translate':
      if (!wantsDelegateHelp) requireProject()
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
      terminal.error(`Unknown command: ${command.name}`)
      return 1
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    terminal.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
