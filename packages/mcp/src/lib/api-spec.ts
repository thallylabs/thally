/**
 * Resolve the OpenAPI documents a Thally site explicitly exposes.
 *
 * Agent tools may edit only sources named by docs.json (or an existing
 * conventional root spec when the site has not configured an API tab yet).
 * This keeps the capability narrow and prevents a model-provided path from
 * becoming an arbitrary repository file write.
 */

import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

import { readDocsJson } from './docs-json.js'

const CONVENTIONAL_API_SOURCES = ['openapi.yaml', 'openapi.yml', 'openapi.json'] as const

function normalizeApiSource(source: string): string | null {
  const normalized = posix.normalize(source.trim().replace(/^\/+/, ''))
  if (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,239}$/.test(normalized) ||
    !/\.(?:json|ya?ml)$/i.test(normalized)
  ) {
    return null
  }
  return normalized
}

/** Return every repository-relative OpenAPI source the project authorizes. */
export function configuredApiSources(projectDir: string): Array<string> {
  const configured = readDocsJson(projectDir)
    .tabs.map((tab) => tab.api?.source)
    .filter((source): source is string => typeof source === 'string')
    .map(normalizeApiSource)
    .filter((source): source is string => source !== null)
  const conventional = CONVENTIONAL_API_SOURCES.filter((source) =>
    existsSync(join(projectDir, source)),
  )
  return [...new Set([...configured, ...conventional])]
}

/** Resolve one requested source, failing closed when it is not configured. */
export function resolveApiSource(projectDir: string, requested?: string): string {
  const sources = configuredApiSources(projectDir)
  const normalizedRequested = requested ? normalizeApiSource(requested) : null
  if (requested && !normalizedRequested) {
    throw new Error('API source must be a repository-relative JSON or YAML file.')
  }
  if (normalizedRequested && sources.includes(normalizedRequested)) {
    return normalizedRequested
  }
  if (!requested && sources.length === 1) return sources[0]!
  if (normalizedRequested) {
    throw new Error(`API source is not configured in docs.json: ${normalizedRequested}`)
  }
  if (sources.length === 0) {
    throw new Error('No OpenAPI source is configured in docs.json.')
  }
  throw new Error(`Multiple OpenAPI sources are configured; choose one of: ${sources.join(', ')}`)
}

export interface ResolvedApiSource {
  source: string
  path: string
}

/** Resolve an authorized source to a regular file that remains inside the project. */
export function resolveApiSourcePath(projectDir: string, requested?: string): ResolvedApiSource {
  const source = resolveApiSource(projectDir, requested)
  const projectRoot = realpathSync(projectDir)
  const candidate = resolve(projectRoot, source)
  try {
    const resolved = realpathSync(candidate)
    const fromRoot = relative(projectRoot, resolved)
    if (
      !fromRoot ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot) ||
      !lstatSync(candidate).isFile() ||
      lstatSync(candidate).isSymbolicLink()
    ) {
      throw new Error('unsafe')
    }
    return { source, path: resolved }
  } catch {
    throw new Error(`API source must be an existing regular file inside the project: ${source}`)
  }
}
