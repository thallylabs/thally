/**
 * Immutable starter archive download and extraction.
 *
 * The dedicated starter repository is already a customer-ready project. Every
 * safe filesystem entry is extracted; there is no exclusion list or second
 * manifest that can silently produce a different scaffold.
 */

import { Readable, Transform, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { extract, type ReadEntry } from 'tar'

import {
  STABLE_SCAFFOLD_RELEASE,
  type ScaffoldRelease,
} from './release.js'
import { readStarterReleaseManifest } from './starter-sync.js'

const pipelineAsync = promisify(pipeline)

const STARTER_FETCH_TIMEOUT_MS = 15_000
const MAX_COMPRESSED_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_EXTRACTED_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_ARCHIVE_FILE_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000

/** Repository whose complete tree becomes every newly scaffolded site. */
export const STARTER_REPOSITORY = STABLE_SCAFFOLD_RELEASE.source.repository

/** Exact starter commit consumed by every creation surface. */
export const STARTER_COMMIT_SHA = STABLE_SCAFFOLD_RELEASE.source.commitSha

/** GitHub codeload's single top-level directory for the pinned archive. */
export const STARTER_ARCHIVE_ROOT =
  `${STARTER_REPOSITORY.split('/').at(-1)}-${STARTER_COMMIT_SHA}`

function starterArchiveRoot(release: ScaffoldRelease): string {
  return `${release.source.repository.split('/').at(-1)}-${release.source.commitSha}`
}

export interface StarterArchiveEntryMetadata {
  type: string
  size: number
}

export interface DownloadStarterOptions {
  /** Scaffold commands announce progress; updater staging stays quiet. */
  announce?: boolean
}

/**
 * Validate one codeload entry before `strip: 1` can write it to disk.
 *
 * Git cannot store devices or FIFOs, and starter sites do not need links. A
 * release containing one is rejected rather than partially extracted because
 * the entire repository tree is the immutable contract.
 */
export function validateStarterArchiveEntry(
  archivePath: string,
  entry: StarterArchiveEntryMetadata,
  archiveRoot = STARTER_ARCHIVE_ROOT,
): void {
  if (
    !archivePath ||
    archivePath.includes('\0') ||
    archivePath.includes('\\') ||
    archivePath.startsWith('/')
  ) {
    throw new Error('The stable Thally starter archive contains an unsafe path.')
  }

  const pathWithoutTrailingSlash = archivePath.endsWith('/')
    ? archivePath.slice(0, -1)
    : archivePath
  const parts = pathWithoutTrailingSlash.split('/')
  const [root, ...relativeParts] = parts
  if (
    root !== archiveRoot ||
    relativeParts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('The stable Thally starter archive contains an unsafe path.')
  }

  if (relativeParts.length === 0 && entry.type !== 'Directory') {
    throw new Error('The stable Thally starter archive has an invalid root entry.')
  }
  if (!['File', 'OldFile', 'Directory'].includes(entry.type)) {
    throw new Error(
      `The stable Thally starter archive contains unsupported entry type ${entry.type}.`,
    )
  }
  if (
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    entry.size > MAX_ARCHIVE_FILE_BYTES
  ) {
    throw new Error('The stable Thally starter archive contains an oversized file.')
  }
}

function starterArchiveFilter(
  archiveRoot: string,
): (path: string, entry: ReadEntry | Stats) => boolean {
  let entryCount = 0
  let extractedBytes = 0

  return (path, entry) => {
    if (!('type' in entry)) {
      throw new Error('The starter archive filter requires extraction metadata.')
    }
    validateStarterArchiveEntry(path, entry, archiveRoot)
    entryCount += 1
    extractedBytes += entry.size
    if (
      entryCount > MAX_ARCHIVE_ENTRIES ||
      extractedBytes > MAX_EXTRACTED_ARCHIVE_BYTES
    ) {
      throw new Error('The stable Thally starter archive exceeds extraction limits.')
    }
    return true
  }
}

function compressedArchiveLimit(): Transform {
  let compressedBytes = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      compressedBytes += chunk.length
      if (compressedBytes > MAX_COMPRESSED_ARCHIVE_BYTES) {
        callback(new Error('The stable Thally starter archive is too large.'))
        return
      }
      callback(null, chunk)
    },
  })
}

/** Download and extract the exact promoted starter repository tree. */
export async function downloadStarter(
  targetDir: string,
  siteName?: string,
  release: ScaffoldRelease = STABLE_SCAFFOLD_RELEASE,
  options: DownloadStarterOptions = {},
): Promise<void> {
  if (options.announce !== false) {
    console.log('')
    console.log(`  ⏳ Creating ${siteName?.trim() || 'your docs site'}...`)
  }

  const targetEntry = lstatSync(targetDir)
  if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
    throw new Error('The Thally starter target must be a regular directory.')
  }
  if (readdirSync(targetDir).length > 0) {
    throw new Error('The Thally starter target directory must be empty.')
  }

  const response = await fetch(release.source.archiveUrl, {
    headers: { accept: 'application/gzip, application/octet-stream;q=0.9' },
    cache: 'no-store',
    signal: AbortSignal.timeout(STARTER_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `Failed to download the stable Thally starter: ${response.status} ${response.statusText}`,
    )
  }
  if (!response.body) {
    throw new Error('The stable Thally starter response body is empty.')
  }

  const contentLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_COMPRESSED_ARCHIVE_BYTES
  ) {
    throw new Error('The stable Thally starter archive is too large.')
  }

  const nodeStream = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0],
  )
  const stagingDir = mkdtempSync(join(tmpdir(), 'thally-starter-download-'))
  try {
    await pipelineAsync(
      nodeStream,
      compressedArchiveLimit(),
      extract({
        cwd: stagingDir,
        strip: 1,
        filter: starterArchiveFilter(starterArchiveRoot(release)),
        preservePaths: false,
        strict: true,
        unlink: true,
        maxDecompressionRatio: 100,
      }),
    )
    readStarterReleaseManifest(stagingDir, release)
    const deliveryDir = mkdtempSync(
      join(dirname(targetDir), '.thally-starter-delivery-'),
    )
    try {
      for (const entry of readdirSync(stagingDir)) {
        cpSync(join(stagingDir, entry), join(deliveryDir, entry), {
          recursive: true,
          errorOnExist: true,
        })
      }
      if (readdirSync(targetDir).length > 0) {
        throw new Error('The Thally starter target changed during download.')
      }
      rmdirSync(targetDir)
      renameSync(deliveryDir, targetDir)
    } finally {
      rmSync(deliveryDir, { recursive: true, force: true })
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true })
  }
}
