/**
 * Migration acceptance gates. Materialization is distinct from a usable site:
 * always retain the imported files and a report when validation fails so the
 * builder can inspect source problems without repeating discovery.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LintIssue } from '../check.js'
import { checkContent } from '../migration-work.js'
import { terminal } from '../terminal.js'
import { runProjectCommand } from '../utils.js'

export interface MigrationValidation {
  content: 'passed' | 'failed' | 'skipped'
  build: 'passed' | 'failed' | 'skipped'
  messages: Array<string>
  diagnostics: Array<LintIssue>
}

/** Validate content and production rendering without repairing authored content. */
export async function validateMigration(projectDir: string, skip = false, installationFailed = false): Promise<MigrationValidation> {
  const result: MigrationValidation = { content: 'skipped', build: 'skipped', messages: [], diagnostics: [] }
  if (skip) {
    result.messages.push('Validation was explicitly skipped; this import is not verified.')
    return result
  }
  try {
    const isQuiet = terminal.isRich && !terminal.isVerbose
    await terminal.step('Validate content', async () => {
      const checked = await checkContent(projectDir)
      const code = checked.code
      result.diagnostics = checked.diagnostics
      if (!isQuiet) {
        for (const issue of checked.diagnostics) {
          const location = issue.file ? `file=${issue.file}${issue.line ? `,line=${issue.line}` : ''}` : ''
          console.log(`::${issue.severity} ${location}::${issue.message}`)
        }
        const errors = checked.diagnostics.filter((issue) => issue.severity === 'error').length
        const warnings = checked.diagnostics.length - errors
        console.log(`\nthally check: ${errors} error(s), ${warnings} warning(s)`)
      }
      if (isQuiet) {
        // Diagnostics remain visible after the spinner settles; never hide
        // security or compatibility warnings behind --verbose.
        for (const issue of result.diagnostics) {
          result.messages.push(`${issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ''}: ` : ''}${issue.message}`)
        }
      }
      if (code !== 0) throw new Error('Review the content diagnostics; source links are not silently rewritten.')
    }, 'Content validated')
    result.content = 'passed'
  } catch (error) {
    if ([130, 143].includes((error as Error & { exitCode?: number }).exitCode ?? 0)) throw error
    result.content = 'failed'
    result.messages.push(`Content validation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (installationFailed) {
    result.build = 'failed'
    result.messages.push('Dependency installation failed; production build was not attempted. Review the installation output before retrying.')
    return result
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
    try {
      await terminal.step('Validate production build', (update) => runProjectCommand('npm', ['run', 'build'], projectDir, 10 * 60 * 1000, (message) => update(`Production build: ${message}`)), 'Production build validated')
      result.build = 'passed'
    } catch (error) {
      const failure = error as Error & { output?: string }
      if (failure.output?.trim()) terminal.error(failure.output.trimEnd())
      throw error
    }
  } catch (error) {
    if ([130, 143].includes((error as Error & { exitCode?: number }).exitCode ?? 0)) throw error
    result.build = 'failed'
    result.messages.push(`Production build failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return result
}
