import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export interface ValidationResult {
  ok: boolean
  errors: Array<string>
  warnings: Array<string>
}

/** Resolve the workspace create-dox CLI (with B1/A8) — never the stale published one. */
function resolveCheckBin(): string {
  try {
    return require.resolve('create-dox')
  } catch {
    return require.resolve('create-dox/dist/index.js')
  }
}

/**
 * Run `dox check --ci` against the project and parse the GitHub-annotation
 * output into structured errors/warnings, so the agent can feed failures back
 * into a repair round.
 */
export function runDocsCheck(projectDir: string): ValidationResult {
  const bin = resolveCheckBin()
  const res = spawnSync('node', [bin, 'check', '--ci', projectDir], {
    encoding: 'utf8',
    cwd: projectDir,
  })
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`

  const errors: Array<string> = []
  const warnings: Array<string> = []
  for (const line of out.split('\n')) {
    const match = line.match(/^::(error|warning)\s+(.*?)::(.*)$/)
    if (!match) continue
    const [, severity, loc, message] = match
    const label = loc ? `${message.trim()} [${loc}]` : message.trim()
    if (severity === 'error') errors.push(label)
    else warnings.push(label)
  }

  return { ok: errors.length === 0, errors, warnings }
}
