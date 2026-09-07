/**
 * Migration acceptance gates. Materialization is distinct from a usable site:
 * always retain the imported files and a report when validation fails so the
 * builder can inspect source problems without repeating discovery.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { runCheck, type LintIssue } from '../check.js'

export interface MigrationValidation {
  content: 'passed' | 'failed' | 'skipped'
  build: 'passed' | 'failed' | 'skipped'
  messages: Array<string>
  diagnostics: Array<LintIssue>
}

/** Validate content and production rendering without repairing authored content. */
export async function validateMigration(projectDir: string, skip = false): Promise<MigrationValidation> {
  const result: MigrationValidation = { content: 'skipped', build: 'skipped', messages: [], diagnostics: [] }
  if (skip) {
    result.messages.push('Validation was explicitly skipped; this import is not verified.')
    return result
  }
  try {
    result.content = await runCheck(projectDir, { fix: false, ci: true, onIssues: (issues) => { result.diagnostics = issues } }) === 0 ? 'passed' : 'failed'
    if (result.content === 'failed') result.messages.push('Content validation failed. Review the check output; source links are not silently rewritten.')
  } catch (error) {
    result.content = 'failed'
    result.messages.push(`Content validation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const packagePath = join(projectDir, 'package.json')
  try {
    const manifest = existsSync(packagePath)
      ? JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: { build?: string } }
      : undefined
    if (!manifest?.scripts?.build) {
      result.messages.push('No build script is available; production rendering is not verified.')
      return result
    }
    // Do not use a shell or interpolate source-controlled strings into a command.
    // npm runs the same project build the developer would invoke themselves.
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: projectDir,
      stdio: 'inherit',
      timeout: 10 * 60 * 1000,
    })
    result.build = build.status === 0 && !build.error ? 'passed' : 'failed'
    if (result.build === 'failed') result.messages.push('Production build failed. Review the build output before publishing.')
  } catch (error) {
    result.build = 'failed'
    result.messages.push(`Production build failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return result
}
