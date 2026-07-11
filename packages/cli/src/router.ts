export interface ParsedArgs {
  command: string | undefined
  /** Positional args after the command. */
  positionals: Array<string>
  /** All raw args after the command (positionals + flags), for passthrough. */
  rest: Array<string>
  flags: Set<string>
  getFlag(name: string): string | undefined
  hasFlag(...names: Array<string>): boolean
}

export interface CommandInfo {
  name: string
  summary: string
  usage: string
}

// The single coherent command surface. The user authors content + config; the
// framework (Next.js) is a hidden runtime invoked by these commands.
export const COMMANDS: Array<CommandInfo> = [
  { name: 'init', summary: 'Scaffold a new Thally project (alias for create-thally-docs)', usage: 'thally init [dir] [--yes]' },
  { name: 'dev', summary: 'Run the docs site locally (agent endpoints live)', usage: 'thally dev [-- <framework args>]' },
  { name: 'build', summary: 'Build the production site', usage: 'thally build' },
  { name: 'start', summary: 'Serve the built production site', usage: 'thally start' },
  { name: 'deploy', summary: 'Build and deploy to a live URL', usage: 'thally deploy [--prod] [--cloudflare]' },
  { name: 'check', summary: 'Lint content + Agent Readiness Score', usage: 'thally check [--agents] [--fix] [--ci] [--drift]' },
  { name: 'new', summary: 'Create a new page and register it in docs.json', usage: 'thally new <page-id> [--title "..."]' },
  { name: 'migrate', summary: 'Migrate docs from a GitHub URL', usage: 'thally migrate <github-url> [dir]' },
  { name: 'translate', summary: 'Translate content into a locale', usage: 'thally translate --locale <code>' },
  { name: 'mcp', summary: 'Start the Model Context Protocol server (stdio)', usage: 'thally mcp' },
  { name: 'agent', summary: 'Draft docs from a task (PR, diff, or instruction) as a reviewed PR', usage: 'thally agent "<instruction>" [--diff <ref>] [--from-pr <url>] [--dry-run] [--pr]' },
  { name: 'track', summary: 'Track product repos — their merged PRs become docs PRs', usage: 'thally track <add|list|test|setup> [owner/repo] [--branch <base>] [--paths <globs>] [--pr <n>]' },
]

export function parseArgs(argv: Array<string>): ParsedArgs {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : undefined
  const rest = command ? argv.slice(1) : argv.slice()

  const positionals: Array<string> = []
  const flags = new Set<string>()
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (token.startsWith('-')) {
      flags.add(token)
      if (i + 1 < rest.length && !rest[i + 1].startsWith('-')) {
        // value-bearing flag: keep the value as a positional-skip
        i += 1
      }
    } else {
      positionals.push(token)
    }
  }

  return {
    command,
    positionals,
    rest,
    flags,
    getFlag(name) {
      const idx = rest.indexOf(name)
      if (idx !== -1 && idx + 1 < rest.length && !rest[idx + 1].startsWith('-')) return rest[idx + 1]
      return undefined
    },
    hasFlag(...names) {
      return names.some((name) => flags.has(name))
    },
  }
}

export function helpText(): string {
  const lines: Array<string> = []
  lines.push('')
  lines.push('  thally — the unified documentation CLI')
  lines.push('')
  lines.push('  You author content/, docs.json, and snippets/.')
  lines.push('  The framework (Next.js) is a hidden runtime — you never touch src/app/.')
  lines.push('')
  lines.push('  Usage: thally <command> [options]')
  lines.push('')
  lines.push('  Commands:')
  const pad = Math.max(...COMMANDS.map((c) => c.name.length))
  for (const command of COMMANDS) {
    lines.push(`    ${command.name.padEnd(pad)}  ${command.summary}`)
  }
  lines.push('')
  lines.push('  Run "thally <command> --help" for command-specific usage.')
  lines.push('')
  return lines.join('\n')
}
