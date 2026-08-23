/**
 * Compute the next immutable scaffold release record from the live heads.
 *
 * Runs only inside promote-release.yml. Reads the current
 * exact `thallylabs/starter` commit selected by the controller (or its main
 * head during manual recovery) and its checked-in `starter-release.json`
 * manifest. It verifies the manifest's runtime pin matches the
 * `thallylabs/thally` commit being promoted, and
 * rewrites the two JSON records consumed by create-thally-docs, the CLI, MCP,
 * and Thally Cloud:
 *
 *  - stable-scaffold-release.json — the new record
 *    (`<date>.<starter8>.<runtime8>`, tree SHAs, manifest sha256)
 *  - previous-scaffold-releases.json — the outgoing stable record prepended,
 *    preserving three-way update bases for already-scaffolded projects
 *
 * Fails loudly on any drift (unpinned runtime, unchanged release id) rather
 * than writing a record the promotion gates would later reject.
 */

import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const GITHUB_API = 'https://api.github.com'
const STARTER_REPOSITORY = 'thallylabs/starter'
const RUNTIME_REPOSITORY = 'thallylabs/thally'
const STABLE_RECORD_PATH = 'packages/create-thally-docs/src/stable-scaffold-release.json'
const PREVIOUS_RECORDS_PATH = 'packages/create-thally-docs/src/previous-scaffold-releases.json'

const token = process.env.GH_TOKEN
if (!token) throw new Error('GH_TOKEN is required.')

/** Authenticated GitHub REST read that fails with the failing URL attached. */
async function githubJson(path) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}): ${path}`)
  }
  return response.json()
}

/** Full commit + tree identity for one branch head or explicit commit. */
async function resolveCommit(repository, ref) {
  const commit = await githubJson(`/repos/${repository}/commits/${ref}`)
  return { commitSha: commit.sha, treeSha: commit.commit.tree.sha }
}

const starterRef = process.env.STARTER_SHA_INPUT?.trim() || 'main'
const starter = await resolveCommit(STARTER_REPOSITORY, starterRef)

// The manifest bytes at the exact starter commit are the release's identity:
// its sha256 lets a scaffolded project prove which starter produced it.
const manifestEntry = await githubJson(
  `/repos/${STARTER_REPOSITORY}/contents/starter-release.json?ref=${starter.commitSha}`,
)
const manifestBytes = Buffer.from(manifestEntry.content, 'base64')
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')

const runtimeRef = process.env.RUNTIME_SHA_INPUT?.trim() || 'main'
const runtime = await resolveCommit(RUNTIME_REPOSITORY, runtimeRef)

// The starter must already pin the runtime being promoted. A mismatch means
// step 1 of the release sequence (repin starter-release.json in the starter
// repo) has not merged yet — promoting now would bind incompatible trees.
const pin = manifest.runtime ?? {}
if (pin.repository !== RUNTIME_REPOSITORY || pin.commitSha !== runtime.commitSha) {
  throw new Error(
    `starter-release.json pins runtime ${pin.repository}@${pin.commitSha}, ` +
      `but the promotion targets ${RUNTIME_REPOSITORY}@${runtime.commitSha}. ` +
      'Merge the starter repin PR first (or pass the matching runtime_sha input).',
  )
}
if (pin.treeSha && pin.treeSha !== runtime.treeSha) {
  throw new Error(
    `starter-release.json pins runtime tree ${pin.treeSha}, but commit ` +
      `${runtime.commitSha} has tree ${runtime.treeSha}.`,
  )
}
if (!Number.isInteger(manifest.starterVersion)) {
  throw new Error('starter-release.json is missing an integer starterVersion.')
}

const currentStable = JSON.parse(readFileSync(STABLE_RECORD_PATH, 'utf8'))
const previousReleases = JSON.parse(readFileSync(PREVIOUS_RECORDS_PATH, 'utf8'))

const releaseId = [
  new Date().toISOString().slice(0, 10),
  starter.commitSha.slice(0, 8),
  runtime.commitSha.slice(0, 8),
].join('.')

if (
  currentStable.source?.commitSha === starter.commitSha &&
  currentStable.runtime?.commitSha === runtime.commitSha
) {
  throw new Error(
    `The stable record already binds starter ${starter.commitSha} to runtime ` +
      `${runtime.commitSha} (${currentStable.id}); there is nothing to promote.`,
  )
}

const nextStable = {
  schemaVersion: 1,
  id: releaseId,
  source: {
    repository: STARTER_REPOSITORY,
    commitSha: starter.commitSha,
    treeSha: starter.treeSha,
    archiveUrl: `https://codeload.github.com/${STARTER_REPOSITORY}/tar.gz/${starter.commitSha}`,
    manifestPath: 'starter-release.json',
    manifestSha256,
  },
  runtime: {
    repository: RUNTIME_REPOSITORY,
    commitSha: runtime.commitSha,
    treeSha: runtime.treeSha,
    contentSource: 'assets',
    // The identity contract only moves with a deliberate engine change; carry
    // the current record's version forward rather than re-deriving it here.
    identityContractVersion: currentStable.runtime.identityContractVersion,
  },
  starterVersion: manifest.starterVersion,
}

writeFileSync(STABLE_RECORD_PATH, `${JSON.stringify(nextStable, null, 2)}\n`)
writeFileSync(
  PREVIOUS_RECORDS_PATH,
  `${JSON.stringify([currentStable, ...previousReleases], null, 2)}\n`,
)

const outputs = [
  `release_id=${releaseId}`,
  `starter_sha=${starter.commitSha}`,
  `runtime_sha=${runtime.commitSha}`,
]
appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`)
console.log(`Computed scaffold release ${releaseId}`)
