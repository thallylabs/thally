import { describe, expect, it } from 'vitest'
import { COMMANDS, commandHelpText, findCommand, helpText, parseArgs, resolveInvocation } from '../router.js'

function run(argv: Array<string>) {
  const invocation = resolveInvocation(argv)
  if (invocation.kind !== 'run') throw new Error(`expected run, got ${JSON.stringify(invocation)}`)
  return invocation.args
}

function error(argv: Array<string>): string {
  const invocation = resolveInvocation(argv)
  if (invocation.kind !== 'error') throw new Error(`expected error, got ${invocation.kind}`)
  return invocation.message
}

describe('parseArgs', () => {
  it('separates command, positionals, and flags', () => {
    const args = parseArgs(['new', 'guides/auth', '--title', 'Authentication', '--fix'])
    expect(args.command).toBe('new')
    expect(args.positionals).toEqual(['guides/auth'])
    expect(args.getFlag('--title')).toBe('Authentication')
    expect(args.hasFlag('--fix')).toBe(true)
    expect(args.hasFlag('--missing')).toBe(false)
  })

  it('treats a leading flag as no command (help)', () => {
    const args = parseArgs(['--help'])
    expect(args.command).toBeUndefined()
    expect(args.hasFlag('--help')).toBe(true)
  })

  it('preserves rest for passthrough', () => {
    const args = parseArgs(['dev', '--', '--port', '4000'])
    expect(args.command).toBe('dev')
    expect(args.rest).toEqual(['--', '--port', '4000'])
    expect(args.passthrough).toEqual(['--port', '4000'])
    expect(args.positionals).toEqual([])
  })

  it.each(['init', 'migrate'])('preserves verbose and delegate flags for %s', (command) => {
    const rest = ['my-docs', '--verbose', '--install', '--yes']
    const args = parseArgs([command, ...rest])
    expect(args.rest).toEqual(rest)
    expect(args.hasFlag('--verbose')).toBe(true)
  })

  it('handles no args', () => {
    const args = parseArgs([])
    expect(args.command).toBeUndefined()
    expect(args.positionals).toEqual([])
  })

  it('accepts --name=value for value options', () => {
    const args = parseArgs(['new', 'intro', '--title=Hello world'])
    expect(args.getFlag('--title')).toBe('Hello world')
    expect(args.positionals).toEqual(['intro'])
  })
})

describe('resolveInvocation', () => {
  it('keeps a boolean flag from swallowing the agent instruction', () => {
    const args = run(['agent', '--pr', 'Document the new endpoint'])
    expect(args.hasFlag('--pr')).toBe(true)
    expect(args.positionals).toEqual(['Document the new endpoint'])
  })

  it('accepts every option real automation passes to thally agent', () => {
    const fromWorkflow = run([
      'agent', 'Document PR', '--from-pr', 'https://github.com/a/b/pull/1',
      '--context-file', '/tmp/ctx.md', '--requester', 'octocat', '--pr',
    ])
    expect(fromWorkflow.positionals).toEqual(['Document PR'])
    expect(fromWorkflow.getFlag('--from-pr')).toBe('https://github.com/a/b/pull/1')
    expect(fromWorkflow.getFlag('--context-file')).toBe('/tmp/ctx.md')
    expect(fromWorkflow.getFlag('--requester')).toBe('octocat')
    expect(fromWorkflow.hasFlag('--pr')).toBe(true)

    const fromCloud = run([
      'agent', 'Apply the sealed plan', '--context-file', '/workspace/vnext-context.json',
      '--write-policy-file', '/workspace/vnext-policy.json', '--require-changes',
      '--result-file', '/workspace/vnext-result.json',
    ])
    expect(fromCloud.positionals).toEqual(['Apply the sealed plan'])
    expect(fromCloud.getFlag('--write-policy-file')).toBe('/workspace/vnext-policy.json')
    expect(fromCloud.getFlag('--result-file')).toBe('/workspace/vnext-result.json')
    expect(fromCloud.hasFlag('--require-changes')).toBe(true)

    expect(run(['agent', 'Explain X', '--diff', 'HEAD~1', '--dry-run']).getFlag('--diff')).toBe('HEAD~1')
    expect(run(['agent', 'init', '--repo', 'acme/docs']).getFlag('--repo')).toBe('acme/docs')
  })

  it('treats --pr as a value option for track but a boolean for agent', () => {
    const args = run(['track', 'test', 'acme/api', '--pr', '12'])
    expect(args.getFlag('--pr')).toBe('12')
    expect(args.positionals).toEqual(['test', 'acme/api'])
    const add = run(['track', 'add', 'acme/api', '--branch', 'main', '--paths', 'src/**', '--tab', 'Docs', '--group', 'API'])
    expect(add.getFlag('--paths')).toBe('src/**')
    expect(run(['track', 'setup', '--repo', 'acme/docs', '--write']).hasFlag('--write')).toBe(true)
  })

  it('accepts the check invocations used by CI and the managed builder', () => {
    expect(run(['check', '--ci', '.']).positionals).toEqual(['.'])
    expect(run(['check', '--drift', '--ci']).hasFlag('--drift')).toBe(true)
    expect(run(['check', '--agents', '--min', '90']).getFlag('--min')).toBe('90')
    expect(run(['check', '--external', '--fix']).hasFlag('--external')).toBe(true)
    expect(run(['deploy', '--prod', '--cf']).hasFlag('--cf')).toBe(true)
    expect(run(['starter', 'update', '--apply']).hasFlag('--apply')).toBe(true)
    expect(run(['new', 'guides/auth', '--title', 'Auth', '--description', 'Sign in']).getFlag('--description')).toBe('Sign in')
  })

  it.each([['deploy'], ['build'], ['dev'], ['start'], ['check'], ['agent'], ['track'], ['starter'], ['new'], ['mcp']])(
    'answers "%s --help" with help instead of running',
    (command) => {
      const invocation = resolveInvocation([command, '--help'])
      expect(invocation.kind).toBe('help')
      if (invocation.kind === 'help') expect(invocation.text).toContain(`Usage: thally ${command}`)
      expect(resolveInvocation([command, 'extra', '-h']).kind).toBe('help')
    },
  )

  it('lets create-thally-docs print help for the commands it owns', () => {
    for (const command of ['init', 'migrate', 'translate']) {
      const invocation = resolveInvocation([command, '--help'])
      expect(invocation.kind).toBe('run')
      if (invocation.kind === 'run') expect(invocation.args.rest).toEqual(['--help'])
    }
  })

  it('supports "thally help <command>"', () => {
    const invocation = resolveInvocation(['help', 'deploy'])
    expect(invocation).toMatchObject({ kind: 'help' })
    if (invocation.kind === 'help') expect(invocation.text).toContain('--cloudflare')
    expect(resolveInvocation(['help', 'nope']).kind).toBe('error')
  })

  it('rejects unknown options with a helpful message', () => {
    expect(error(['deploy', '--prdo'])).toBe('Unknown option "--prdo" for "thally deploy".')
    expect(error(['--bogus'])).toContain('Run "thally --help"')
    expect(error(['new', 'page', '--title'])).toContain('needs a value')
    expect(error(['new', 'page', '--title', '--description', 'x'])).toContain('needs a value')
    expect(error(['deploy', '--prod=yes'])).toContain('does not take a value')
    expect(error(['deploy', 'somewhere'])).toContain('Unexpected argument "somewhere"')
    expect(error(['deploy', '--', '--x'])).toContain('does not accept arguments after --')
  })

  it('points framework options at the -- separator', () => {
    expect(error(['dev', '--port', '4000'])).toContain('thally dev -- --port 4000')
    expect(error(['dev', '4000'])).toContain('thally dev -- 4000')
    const args = run(['dev', '--', '--port', '4000', '--help'])
    expect(args.passthrough).toEqual(['--port', '4000', '--help'])
    expect(run(['build', '--', '--debug']).passthrough).toEqual(['--debug'])
  })

  it('never validates delegate arguments', () => {
    const args = run(['migrate', 'https://docs.example.com', '--platform', 'fern', '--anything'])
    expect(args.rest).toEqual(['https://docs.example.com', '--platform', 'fern', '--anything'])
    expect(run(['create', 'my-docs', '--yes']).rest).toEqual(['my-docs', '--yes'])
    expect(findCommand('create')?.name).toBe('init')
  })
})

describe('helpText', () => {
  it('lists every command', () => {
    const text = helpText()
    for (const command of COMMANDS) {
      expect(text).toContain(command.name)
    }
    expect(text).toContain('Product knowledge, kept in step with your code.')
    expect(text).toContain('Create and write')
    expect(text).toContain('Preview and publish')
    expect(text).toContain('Keep knowledge current')
    expect(text).toContain('--verbose')
    expect(text).toContain('fern')
    expect(text).not.toContain('Next.js')
    expect(text).not.toContain('hidden runtime')
    expect(text).not.toContain('command-specific usage')
  })

  it('omits automation-only options from command help', () => {
    const agent = commandHelpText(findCommand('agent')!)
    expect(agent).toContain('--from-pr <url>')
    expect(agent).not.toContain('--result-file')
    expect(commandHelpText(findCommand('migrate')!)).toContain('mintlify|docusaurus|fern|auto')
  })
})
