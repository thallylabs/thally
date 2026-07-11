import { Readable, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import tar from 'tar'

const pipelineAsync = promisify(pipeline)

const TARBALL_URL = 'https://codeload.github.com/thallylabs/thally/tar.gz/main'

// The Thally template repo is ALSO the live Thally project (its own deployment,
// self-tracking config, and CI). These paths carry that project-specific wiring
// and must NOT be copied into a user's scaffold, or every new site would inherit
// Thally's own setup:
//   - `/cli/`, `/packages/`  — the monorepo's tooling; scaffolds consume the
//                              PUBLISHED @thallylabs/* packages instead of the source.
//   - `/thally-agent.yml`    — the docs-agent runner. Track/the agent are OPT-IN;
//     `/thally-track.yml`       a scaffolded site adds these via `thally agent init`
//                              / `thally track setup`, so shipping them pre-baked
//                              (with a weekly cron + upstream dispatch) is wrong.
//   - `/CODEOWNERS`          — Thally's roster gate points at its maintainers;
//                              inheriting it would demand their review on a user's PRs.
// (The `tracking` block in docs.json is stripped separately — see
// resetTrackingConfig — because docs.json itself must be copied.)
export const EXCLUDE_PATHS = [
  '/cli/',
  '/packages/',
  '/node_modules/',
  '/.git/',
  '/thally-agent.yml',
  '/thally-track.yml',
  '/CODEOWNERS',
]

/** True if a tarball entry should land in the scaffold (see EXCLUDE_PATHS). */
export function shouldInclude(path: string): boolean {
  for (const excluded of EXCLUDE_PATHS) {
    if (path.includes(excluded)) {
      return false
    }
  }
  return true
}

export async function downloadTemplate(targetDir: string, siteName?: string): Promise<void> {
  console.log('')
  console.log(`  ⏳ Creating ${siteName?.trim() || 'your docs site'}...`)

  const response = await fetch(TARBALL_URL)

  if (!response.ok) {
    throw new Error(`Failed to download template: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('Response body is empty')
  }

  // Convert Web Streams ReadableStream to Node.js Readable, then pipe into tar
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

  await pipelineAsync(
    nodeStream,
    tar.extract({ cwd: targetDir, strip: 1, filter: shouldInclude }),
  )
}
