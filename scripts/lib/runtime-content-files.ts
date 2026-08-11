/**
 * Build-time inventory and static-asset writer for authored runtime content.
 *
 * Managed hosting keeps customer content out of executable Worker modules.
 * This module defines the one file inventory shared by the generated embedded
 * fallback and the immutable assets release, preventing the two delivery
 * paths from silently drifting apart.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

export interface RuntimeSourceEntry {
  content: string
  modifiedAtMs: number
}

export type RuntimeSourceMap = Record<string, RuntimeSourceEntry>

export interface ContentAssetManifest {
  version: 1
  files: Record<string, { modifiedAtMs: number }>
}

/** Reserved public directory copied verbatim into OpenNext static assets. */
export const MANAGED_CONTENT_ASSET_DIRECTORY = 'public/_thally/content'

function projectPath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

function addTextFile(
  projectRoot: string,
  sources: RuntimeSourceMap,
  filePath: string,
): void {
  if (!existsSync(filePath)) return
  const stats = statSync(filePath)
  if (!stats.isFile()) return
  sources[projectPath(projectRoot, filePath)] = {
    content: readFileSync(filePath, 'utf8'),
    modifiedAtMs: stats.mtimeMs,
  }
}

function walkTextFiles(
  projectRoot: string,
  sources: RuntimeSourceMap,
  directory: string,
  extensions: ReadonlyArray<string>,
): void {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walkTextFiles(projectRoot, sources, filePath, extensions)
    } else if (
      entry.isFile() &&
      extensions.some((extension) => entry.name.endsWith(extension))
    ) {
      addTextFile(projectRoot, sources, filePath)
    }
  }
}

/**
 * Collect every authored text input required by the deployed docs runtime.
 * Binary public assets are already handled by Next/OpenNext and deliberately
 * stay outside this manifest; file-backed API specs are included explicitly.
 */
export function collectRuntimeContentFiles(projectRoot: string): RuntimeSourceMap {
  const sources: RuntimeSourceMap = {}
  walkTextFiles(projectRoot, sources, path.join(projectRoot, 'src/content'), ['.mdx', '.md'])
  walkTextFiles(projectRoot, sources, path.join(projectRoot, 'snippets'), ['.mdx', '.md'])
  walkTextFiles(projectRoot, sources, path.join(projectRoot, 'public'), [
    '.yaml',
    '.yml',
    '.json',
  ])
  addTextFile(projectRoot, sources, path.join(projectRoot, 'openapi.yaml'))
  addTextFile(projectRoot, sources, path.join(projectRoot, 'openapi.yml'))
  addTextFile(projectRoot, sources, path.join(projectRoot, 'openapi.json'))
  addTextFile(projectRoot, sources, path.join(projectRoot, 'docs.json'))
  addTextFile(projectRoot, sources, path.join(projectRoot, 'AGENTS.md'))
  return sources
}

function assertSafeProjectPath(filePath: string): void {
  if (
    !filePath ||
    path.posix.isAbsolute(filePath) ||
    filePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Managed content asset path is unsafe: ${filePath}`)
  }
}

/**
 * Emit the immutable managed-content tree into `public/` before Next builds.
 * OpenNext copies this directory to `.open-next/assets`, where `env.ASSETS`
 * serves it without adding a byte to the executable Worker module graph.
 */
export function writeManagedContentAssets(
  projectRoot: string,
  sources: Readonly<RuntimeSourceMap>,
): ContentAssetManifest {
  const outputRoot = path.join(projectRoot, MANAGED_CONTENT_ASSET_DIRECTORY)
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })

  const manifest: ContentAssetManifest = { version: 1, files: {} }
  for (const [filePath, entry] of Object.entries(sources).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    assertSafeProjectPath(filePath)
    const outputPath = path.join(outputRoot, ...filePath.split('/'))
    mkdirSync(path.dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, entry.content, 'utf8')
    manifest.files[filePath] = { modifiedAtMs: entry.modifiedAtMs }
  }

  writeFileSync(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest)}\n`,
    'utf8',
  )
  return manifest
}

/** Remove a previous managed tree when switching back to embedded mode. */
export function removeManagedContentAssets(projectRoot: string): void {
  rmSync(path.join(projectRoot, MANAGED_CONTENT_ASSET_DIRECTORY), {
    recursive: true,
    force: true,
  })
}
