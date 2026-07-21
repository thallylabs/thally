import { Readable, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import tar from 'tar'

const pipelineAsync = promisify(pipeline)

/**
 * The live Thally documentation site is also the canonical standalone site
 * source. Keeping one source means a runtime or UI improvement shipped to the
 * docs is available to every subsequent scaffold without maintaining a second
 * template repository.
 */
export const TEMPLATE_REPOSITORY = 'thallylabs/docs'
const TARBALL_URL = `https://codeload.github.com/${TEMPLATE_REPOSITORY}/tar.gz/main`

// The source repo is ALSO the live Thally docs project. These paths contain its
// public documentation, screenshots, generated caches, and maintainer-specific
// automation. The scaffold writes a small starter README/content set instead.
// Generic CI, the review-gated docs-agent receiver, and the reusable
// application/runtime are deliberately retained. Product-specific Track
// senders remain opt-in.
// (The `tracking` block in docs.json is stripped separately — see
// resetTrackingConfig — because docs.json itself must be copied.)
export const EXCLUDE_PATHS = [
  // Match both the directory entry itself and every nested file. Tar invokes
  // the filter for `.../node_modules` before descendants, without a trailing `/`.
  '/node_modules',
  // The canonical docs repository may temporarily retain package sources while
  // runtime work is being upstreamed. A scaffold consumes the published
  // packages declared in package.json; it must never inherit those sources.
  '/packages',
  '/.git/',
  '/.next/',
  '/.data/',
  '/.thally/',
  '/thally-track.yml',
  '/CODEOWNERS',
  '/CLAUDE.md',
  '/notes/',
  '/public/images/',
  '/src/public/',
  '/snippets/',
  '/.github/ISSUE_TEMPLATE/',
  '/.github/PULL_REQUEST_TEMPLATE.md',
  '/README.md',
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
