/**
 * Build and validate the Cloudflare deployment with explicit build context.
 *
 * Managed workflows select asset-backed content with THALLY_CONTENT_SOURCE.
 * This wrapper only marks the local build phase, allowing page-data collection
 * to read authored files before an ASSETS binding exists. Self-hosted builds
 * keep their default embedded-content behavior unchanged.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

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
// The managed builder reads this build-owned marker before admitting the
// release as a parent for docs.json-only publishes. Repositories on an older
// runtime omit it and safely take the full-build path until upgraded.
mkdirSync('.open-next/assets/_thally', { recursive: true })
writeFileSync(
  '.open-next/assets/_thally/runtime-capabilities.json',
  `${JSON.stringify({ version: 1, docsConfigBinding: true })}\n`,
  'utf8',
)
runNpmScript('package:cloudflare')
runNpmScript('check:cloudflare-size')
