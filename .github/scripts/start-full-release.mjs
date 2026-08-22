/**
 * Start the same protected Full release workflow exposed by GitHub's button.
 *
 * This local entrypoint deliberately does not publish or mutate repositories
 * itself. It uses the operator's existing `gh` login to dispatch the fixed
 * workflow on `main`, where the release-control environment and short-lived
 * coordinator App token enforce the cross-repository permission boundary.
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'thallylabs/thally'
const WORKFLOW = 'full-release.yml'

/** Dispatch Full release with the operator's authenticated GitHub CLI. */
export function startFullRelease(argumentsList = process.argv.slice(2)) {
  if (argumentsList.length > 0) {
    throw new Error('Usage: npm run release:full')
  }
  const commandArguments = [
    'workflow',
    'run',
    WORKFLOW,
    '--repo',
    REPOSITORY,
    '--ref',
    'main',
  ]

  const result = spawnSync('gh', commandArguments, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`GitHub CLI exited with status ${result.status}.`)
  }
  console.log(`Release started: https://github.com/${REPOSITORY}/actions/workflows/${WORKFLOW}`)
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  startFullRelease()
}
