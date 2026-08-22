/**
 * Validate the promoted scaffold record and prepare the immutable cloud handoff.
 *
 * The dispatch deliberately carries only a locator. Thally Cloud must fetch the
 * record from the exact public commit and validate it again, so neither side
 * treats event payload data as a release authority.
 */

import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const RELEASE_HANDOFF_SCHEMA_VERSION = 1
export const RELEASE_HANDOFF_EVENT = 'scaffold-release-published'
export const RELEASE_RECORD_REPOSITORY = 'thallylabs/thally'
export const RELEASE_RECORD_PATH =
  'packages/create-thally-docs/src/stable-scaffold-release.json'

const STARTER_REPOSITORY = 'thallylabs/starter'
const SHA_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RELEASE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}\.[0-9a-f]{8}$/

/** Fail with one stable, operator-facing validation error. */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Build the locator-only payload sent after every package is published.
 *
 * Strict validation here catches a malformed promotion before it crosses the
 * repository trust boundary. The receiving workflow independently repeats
 * validation after reading this path at this exact commit.
 */
export function createReleaseHandoffPayload({
  record,
  recordRepository,
  recordCommitSha,
}) {
  requireCondition(
    recordRepository === RELEASE_RECORD_REPOSITORY,
    `Release records must come from ${RELEASE_RECORD_REPOSITORY}.`,
  )
  requireCondition(
    SHA_PATTERN.test(recordCommitSha),
    'The release-record commit must be a lowercase 40-character SHA.',
  )
  requireCondition(
    record && typeof record === 'object' && !Array.isArray(record),
    'The stable scaffold release must be an object.',
  )
  requireCondition(record.schemaVersion === 1, 'Unsupported scaffold release schema.')
  requireCondition(RELEASE_ID_PATTERN.test(record.id), 'Invalid scaffold release id.')

  const source = record.source ?? {}
  requireCondition(
    source.repository === STARTER_REPOSITORY,
    `Scaffold source must be ${STARTER_REPOSITORY}.`,
  )
  requireCondition(SHA_PATTERN.test(source.commitSha), 'Invalid starter commit SHA.')
  requireCondition(SHA_PATTERN.test(source.treeSha), 'Invalid starter tree SHA.')
  requireCondition(
    source.archiveUrl ===
      `https://codeload.github.com/${STARTER_REPOSITORY}/tar.gz/${source.commitSha}`,
    'The starter archive URL must bind the exact promoted commit.',
  )
  requireCondition(
    source.manifestPath === 'starter-release.json',
    'The starter manifest path is not supported.',
  )
  requireCondition(
    SHA256_PATTERN.test(source.manifestSha256),
    'Invalid starter manifest SHA-256.',
  )

  const runtime = record.runtime ?? {}
  requireCondition(
    runtime.repository === RELEASE_RECORD_REPOSITORY,
    `Runtime source must be ${RELEASE_RECORD_REPOSITORY}.`,
  )
  requireCondition(SHA_PATTERN.test(runtime.commitSha), 'Invalid runtime commit SHA.')
  requireCondition(SHA_PATTERN.test(runtime.treeSha), 'Invalid runtime tree SHA.')
  requireCondition(runtime.contentSource === 'assets', 'Unsupported runtime content source.')
  requireCondition(
    Number.isInteger(runtime.identityContractVersion) &&
      runtime.identityContractVersion > 0,
    'Invalid runtime identity contract version.',
  )
  requireCondition(
    Number.isInteger(record.starterVersion) && record.starterVersion > 0,
    'Invalid starter version.',
  )
  requireCondition(
    record.id.endsWith(
      `.${source.commitSha.slice(0, 8)}.${runtime.commitSha.slice(0, 8)}`,
    ),
    'The release id does not match the promoted starter and runtime commits.',
  )

  return {
    schema_version: RELEASE_HANDOFF_SCHEMA_VERSION,
    release_id: record.id,
    record_repository: RELEASE_RECORD_REPOSITORY,
    record_commit_sha: recordCommitSha,
    record_path: RELEASE_RECORD_PATH,
  }
}

/** Write payload fields as single-line GitHub Actions outputs. */
export function writeReleaseHandoffOutputs(outputPath, payload) {
  requireCondition(outputPath, 'GITHUB_OUTPUT is required.')
  appendFileSync(
    outputPath,
    `${Object.entries(payload)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  )
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  const releaseSourceDirectory = process.env.RELEASE_SOURCE_DIRECTORY ?? '.'
  const record = JSON.parse(
    readFileSync(join(releaseSourceDirectory, RELEASE_RECORD_PATH), 'utf8'),
  )
  const payload = createReleaseHandoffPayload({
    record,
    recordRepository: process.env.GITHUB_REPOSITORY,
    recordCommitSha: process.env.GITHUB_SHA ?? '',
  })
  writeReleaseHandoffOutputs(process.env.GITHUB_OUTPUT, payload)
  console.log(`Prepared ${RELEASE_HANDOFF_EVENT} for ${payload.release_id}`)
}
