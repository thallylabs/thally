/**
 * Focused tests for the public-to-cloud scaffold release handoff boundary.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  RELEASE_RECORD_PATH,
  createReleaseHandoffPayload,
} from './prepare-release-handoff.mjs'

const stableRecord = JSON.parse(readFileSync(RELEASE_RECORD_PATH, 'utf8'))
const recordCommitSha = 'a'.repeat(40)

/** Return a detached fixture so each rejection test can mutate safely. */
function releaseFixture() {
  return structuredClone(stableRecord)
}

test('prepares the locator-only schema from a valid promoted record', () => {
  assert.deepEqual(
    createReleaseHandoffPayload({
      record: releaseFixture(),
      recordRepository: 'thallylabs/thally',
      recordCommitSha,
    }),
    {
      schema_version: 1,
      release_id: stableRecord.id,
      record_repository: 'thallylabs/thally',
      record_commit_sha: recordCommitSha,
      record_path: RELEASE_RECORD_PATH,
    },
  )
})

test('rejects a dispatch locator outside the allowlisted public repository', () => {
  assert.throws(
    () =>
      createReleaseHandoffPayload({
        record: releaseFixture(),
        recordRepository: 'attacker/fork',
        recordCommitSha,
      }),
    /Release records must come from thallylabs\/thally/,
  )
})

test('rejects a mutable or mismatched starter archive URL', () => {
  const record = releaseFixture()
  record.source.archiveUrl = 'https://codeload.github.com/thallylabs/starter/tar.gz/main'

  assert.throws(
    () =>
      createReleaseHandoffPayload({
        record,
        recordRepository: 'thallylabs/thally',
        recordCommitSha,
      }),
    /starter archive URL must bind the exact promoted commit/,
  )
})

test('rejects a release id that is not bound to both promoted commits', () => {
  const record = releaseFixture()
  record.id = '2026-08-08.00000000.00000000'

  assert.throws(
    () =>
      createReleaseHandoffPayload({
        record,
        recordRepository: 'thallylabs/thally',
        recordCommitSha,
      }),
    /release id does not match/,
  )
})
