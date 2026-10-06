/**
 * Run CPU-heavy migration projections off the CLI event loop. Workers receive
 * serializable data only and never write directly to the command's output.
 */
import { Worker } from 'node:worker_threads'
import type { migrateRepository, migrateUrl, renderMigrationFiles } from '@thallylabs/migrate'
import type { LintIssue } from './check.js'

export interface MigrationWorkerOptions {
  /** Override the compiled worker location for host integration tests. */
  workerUrl?: URL
}

export interface MigrationWorkerRequest {
  operation: 'repository' | 'render' | 'url' | 'check'
  args: Parameters<typeof migrateRepository> | Parameters<typeof renderMigrationFiles> | Parameters<typeof migrateUrl> | [string]
}

/** Run one isolated operation and release its worker on every outcome. */
async function runMigrationWork<Result>(request: MigrationWorkerRequest, options: MigrationWorkerOptions): Promise<Result> {
  const worker = new Worker(options.workerUrl ?? new URL('./migration-worker.js', import.meta.url), {
    workerData: request,
    stdout: true,
    stderr: true,
  })
  // A library dependency must not leak incidental logs into an MCP host's stdio.
  worker.stdout.resume()
  worker.stderr.resume()
  try {
    return await new Promise<Result>((complete, reject) => {
      worker.once('message', (response: { result?: Result; error?: Error }) => {
        if (response.error) reject(response.error)
        else complete(response.result as Result)
      })
      worker.once('error', reject)
      worker.once('exit', (code) => reject(new Error(`Migration worker exited before returning a result (exit ${code}).`)))
    })
  } finally {
    await worker.terminate()
  }
}

/** Convert authored repository content without blocking terminal progress. */
export function convertRepository(options: Parameters<typeof migrateRepository>[0], workerOptions: MigrationWorkerOptions = {}): Promise<ReturnType<typeof migrateRepository>> {
  return runMigrationWork({ operation: 'repository', args: [options] }, workerOptions)
}

/** Render the same migration projections while leaving main-thread writes contained. */
export function renderFiles(bundle: Parameters<typeof renderMigrationFiles>[0], options: Parameters<typeof renderMigrationFiles>[1], workerOptions: MigrationWorkerOptions = {}): Promise<ReturnType<typeof renderMigrationFiles>> {
  return runMigrationWork({ operation: 'render', args: [bundle, options] }, workerOptions)
}

/** Discover a public site off-thread; custom host fetch callbacks stay in-process. */
export function discoverUrl(options: Omit<Parameters<typeof migrateUrl>[0], 'fetcher'>, workerOptions: MigrationWorkerOptions = {}): ReturnType<typeof migrateUrl> {
  return runMigrationWork({ operation: 'url', args: [options] }, workerOptions)
}

export interface ContentCheckResult {
  code: number
  diagnostics: Array<LintIssue>
}

/** Check imported content off-thread while keeping diagnostics in the host's control. */
export function checkContent(projectDir: string, workerOptions: MigrationWorkerOptions = {}): Promise<ContentCheckResult> {
  return runMigrationWork({ operation: 'check', args: [projectDir] }, workerOptions)
}
