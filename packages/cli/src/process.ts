import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

export function run(command: string, args: Array<string>, cwd = process.cwd()): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('close', (code) => resolve(code ?? 0))
    child.on('error', () => resolve(127))
  })
}

/** Resolve a workspace/dep package's bin path so we can invoke it via node. */
export function resolveBin(pkg: string, binName: string): string | null {
  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`)
    const pkgDir = path.dirname(pkgJsonPath)
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as { bin?: string | Record<string, string> }
    const binRel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName]
    if (!binRel) return null
    return path.join(pkgDir, binRel)
  } catch {
    return null
  }
}

/** True when the current directory looks like a Thally project. */
export function isThallyProject(cwd = process.cwd()): boolean {
  return existsSync(path.join(cwd, 'docs.json'))
}

export interface PackageScripts {
  scripts?: Record<string, string>
}

export function projectScripts(cwd = process.cwd()): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as PackageScripts
    return pkg.scripts ?? {}
  } catch {
    return {}
  }
}

/**
 * Run a framework task. Prefers the project's npm script (so the framework is
 * a hidden implementation detail), falling back to `npx next <task>`.
 */
export function runFramework(task: string, scriptName: string, passthrough: Array<string> = []): Promise<number> {
  const scripts = projectScripts()
  if (scripts[scriptName]) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    return run(npm, ['run', scriptName, ...(passthrough.length ? ['--', ...passthrough] : [])])
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  return run(npx, ['next', task, ...passthrough])
}

/** Run a sibling package binary (create-thally-docs, thally-mcp) via node. */
export function runPackageBin(pkg: string, binName: string, args: Array<string>): Promise<number> {
  const bin = resolveBin(pkg, binName)
  if (!bin) {
    process.stderr.write(`\n  Could not resolve the "${binName}" binary from "${pkg}".\n  Is it installed in this project?\n\n`)
    return Promise.resolve(127)
  }
  return run(process.execPath, [bin, ...args])
}
