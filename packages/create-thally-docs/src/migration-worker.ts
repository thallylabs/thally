/**
 * Isolated CPU execution for the public CLI's shared migration engine. It uses
 * the same engine operations as in-process callers; no host callbacks cross threads.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { migrateRepository, migrateUrl, renderMigrationFiles } from '@thallylabs/migrate'
import type { MigrationWorkerRequest } from './migration-work.js'
import { runCheck, type LintIssue } from './check.js'

/** Dispatch only the fixed engine operations supported by the CLI host. */
async function execute(request: MigrationWorkerRequest) {
  if (request.operation === 'check') {
    let diagnostics: Array<LintIssue> = []
    const code = await runCheck(request.args[0] as string, {
      fix: false,
      ci: true,
      silent: true,
      onIssues: (issues) => { diagnostics = issues },
    })
    return { code, diagnostics }
  }
  if (request.operation === 'repository') {
    return migrateRepository(...request.args as Parameters<typeof migrateRepository>)
  }
  if (request.operation === 'url') {
    return migrateUrl(...request.args as Parameters<typeof migrateUrl>)
  }
  return renderMigrationFiles(...request.args as Parameters<typeof renderMigrationFiles>)
}

if (!parentPort) throw new Error('Migration worker requires a parent thread.')
try {
  parentPort.postMessage({ result: await execute(workerData as MigrationWorkerRequest) })
} catch (error) {
  // Node's structured clone preserves Error messages, stacks, and causes.
  parentPort.postMessage({ error: error instanceof Error ? error : new Error(String(error)) })
}
