/**
 * Read-only access to source files embedded by the production build.
 *
 * Development keeps direct filesystem reads for fast authoring feedback. A
 * production runtime reads the generated module, so all projections still use
 * the exact customer-authored bytes without requiring a filesystem at the edge.
 */

import fs from 'node:fs'
import path from 'node:path'
import { runtimeSources } from '@/generated/runtime-sources'

function normalizedProjectPath(filePath: string): string {
  const absolute = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), filePath)
  const relative = path.relative(process.cwd(), absolute).split(path.sep).join('/')
  if (!relative || relative === '..' || relative.startsWith('../')) {
    throw new Error('Runtime source path must stay inside the project root.')
  }
  return relative
}

function isDevelopmentFilesystemAvailable(): boolean {
  return process.env.NODE_ENV === 'development'
}

/** Return true when a generated or development source file exists. */
export function runtimeSourceExists(filePath: string): boolean {
  const key = normalizedProjectPath(filePath)
  if (
    isDevelopmentFilesystemAvailable() &&
    fs.existsSync(path.resolve(/* turbopackIgnore: true */ process.cwd(), key))
  ) {
    return true
  }
  return Boolean(runtimeSources[key])
}

/** Read one UTF-8 project source without exposing arbitrary filesystem paths. */
export function readRuntimeSource(filePath: string): string {
  const key = normalizedProjectPath(filePath)
  if (isDevelopmentFilesystemAvailable()) {
    const absolute = path.resolve(/* turbopackIgnore: true */ process.cwd(), key)
    if (fs.existsSync(absolute)) return fs.readFileSync(absolute, 'utf8')
  }
  const source = runtimeSources[key]
  if (!source) {
    const error = new Error(`Runtime source not found: ${key}`) as NodeJS.ErrnoException
    error.code = 'ENOENT'
    throw error
  }
  return source.content
}

/** Return the build-observed modification time used for translation staleness. */
export function runtimeSourceModifiedAt(filePath: string): number {
  const key = normalizedProjectPath(filePath)
  if (isDevelopmentFilesystemAvailable()) {
    const absolute = path.resolve(/* turbopackIgnore: true */ process.cwd(), key)
    if (fs.existsSync(absolute)) return fs.statSync(absolute).mtimeMs
  }
  return runtimeSources[key]?.modifiedAtMs ?? 0
}

/** List embedded file paths below a project-relative directory prefix. */
export function listRuntimeSources(prefix: string): Array<string> {
  const normalizedPrefix = normalizedProjectPath(prefix).replace(/\/$/, '') + '/'
  if (isDevelopmentFilesystemAvailable()) {
    const root = path.resolve(/* turbopackIgnore: true */ process.cwd(), normalizedPrefix)
    const files: Array<string> = []
    const walk = (directory: string) => {
      if (!fs.existsSync(directory)) return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(candidate)
        else if (entry.isFile()) files.push(normalizedProjectPath(candidate))
      }
    }
    walk(root)
    return files
  }
  return Object.keys(runtimeSources).filter((key) => key.startsWith(normalizedPrefix))
}
