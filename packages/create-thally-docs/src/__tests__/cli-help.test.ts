/** Black-box coverage for help and invalid-option behavior in the published CLI. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cliPath = fileURLToPath(new URL('../../dist/index.js', import.meta.url))
const packageMetadata = createRequire(import.meta.url)('../../package.json') as {
  version: string
}

function runCli(...args: Array<string>) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    input: '',
    timeout: 5_000,
  })
}

describe('create-thally-docs help', () => {
  it.each(['--version', '-v', '-V', 'version'])('prints the package version for %s', (argument) => {
    const result = runCli(argument)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${packageMetadata.version}\n`)
    expect(result.stderr).toBe('')
  })

  it.each(['--help', '-h'])('prints root help without prompting for %s', (flag) => {
    const result = runCli(flag)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('create-thally-docs <command>')
    expect(result.stdout).not.toContain('Project directory:')
    expect(result.stderr).toBe('')
  })

  it.each([
    ['migrate', '<github-or-docs-url>', '--max-pages <count>'],
    ['check', '[project-dir]', '--external'],
    ['translate', '--locale <code>', '--pages <ids>'],
  ])('prints scoped %s help without prompting', (command, usage, option) => {
    const result = runCli(command, '--help')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`create-thally-docs ${command}`)
    expect(result.stdout).toContain(usage)
    expect(result.stdout).toContain(option)
    expect(result.stdout).not.toContain('Project directory:')
    expect(result.stderr).toBe('')
  })

  it('rejects unknown scaffold options with a useful error', () => {
    const result = runCli('--unknown')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown option "--unknown"')
    expect(result.stderr).toContain('create-thally-docs --help')
    expect(result.stdout).not.toContain('Project directory:')
  })

  it('rejects options outside a subcommand scope', () => {
    const result = runCli('check', '--install')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown option "--install"')
    expect(result.stderr).toContain('create-thally-docs check --help')
  })
})
