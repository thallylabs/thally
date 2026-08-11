/**
 * Build and validate the Cloudflare deployment with explicit build context.
 *
 * Managed workflows select asset-backed content with THALLY_CONTENT_SOURCE.
 * This wrapper only marks the local build phase, allowing page-data collection
 * to read authored files before an ASSETS binding exists. Self-hosted builds
 * keep their default embedded-content behavior unchanged.
 */

import { spawnSync } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const environment = {
  ...process.env,
  THALLY_CONTENT_BUILD: '1',
}

function runNpmScript(script: string): void {
  const result = spawnSync(npmCommand, ['run', script], {
    env: environment,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status ?? 'unknown'}.`)
  }
}

runNpmScript('build:cloudflare:opennext')
runNpmScript('package:cloudflare')
runNpmScript('check:cloudflare-size')
