/** Black-box coverage for informational and invalid root CLI arguments. */

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
    timeout: 5_000,
  })
}

describe('thally version', () => {
  it.each(['--version', '-v', '-V', 'version'])('prints the package version for %s', (argument) => {
    const result = runCli(argument)

    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${packageMetadata.version}\n`)
    expect(result.stderr).toBe('')
  })

  it('preserves root help behavior', () => {
    const result = runCli('--help')

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: thally <command> [options]')
    expect(result.stderr).toBe('')
  })

  it('preserves unknown-command behavior', () => {
    const result = runCli('unknown')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown command: unknown')
    expect(result.stdout).toContain('Usage: thally <command> [options]')
  })
})
