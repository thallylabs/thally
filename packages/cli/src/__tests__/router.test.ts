import { describe, expect, it } from 'vitest'
import { COMMANDS, helpText, parseArgs } from '../router.js'

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
    const args = parseArgs(['dev', '--port', '4000'])
    expect(args.command).toBe('dev')
    expect(args.rest).toEqual(['--port', '4000'])
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
    expect(text).not.toContain('Next.js')
    expect(text).not.toContain('hidden runtime')
    expect(text).not.toContain('command-specific usage')
  })
})
