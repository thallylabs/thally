/**
 * Mintlify `sourceRef` navigation nodes mount the docs of another repository
 * (`{"sourceRef": "owner/repo"}`). The mount path is not derivable from any
 * docs.json, so the caller supplies it with `--source-ref owner/repo=<path>`.
 * The referenced repository is untrusted remote content: it is validated,
 * size-capped, stripped of symlinks and dot-directories, then run through the
 * same repository pipeline as the main site and prefixed with its mount path.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { replaceOutsideCodeAndComments } from './mdx.js'
import { migrateRepository } from './repository.js'
import type { MigrationAsset, MigrationDocsConfig, MigrationNavigationGroup, MigrationPage, MigrationWarning } from './types.js'

/** Per referenced repository: files and bytes under its docs root. Constants on purpose, not configurable. */
export const SOURCE_REF_MAX_FILES = 5_000
export const SOURCE_REF_MAX_BYTES = 50_000_000
const MAX_FORWARDED_WARNINGS = 50

const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
const MOUNT_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/

export interface SourceRefMapping {
  /** `owner/repo`, exactly as written in the source navigation. */
  repo: string
  /** Relative slug path the referenced docs are mounted at, e.g. `client-sdks/typescript`. */
  mountPath: string
}

export interface SourceRefImport extends SourceRefMapping {
  pages: Array<MigrationPage>
  assets: Array<MigrationAsset>
  /** Navigation entries with every page id already prefixed by the mount path. */
  navigation: Array<string | MigrationNavigationGroup>
  /** Why the import is empty (or partial), plus forwarded pipeline warnings. */
  warnings: Array<MigrationWarning>
}

/** Parse repeated `owner/repo=mount/path` values; throws on anything unsafe. */
export function parseSourceRefFlags(values: ReadonlyArray<string>): Array<SourceRefMapping> {
  const mappings: Array<SourceRefMapping> = []
  for (const value of values) {
    const separator = value.indexOf('=')
    const repo = separator < 0 ? value : value.slice(0, separator)
    const mountPath = separator < 0 ? '' : value.slice(separator + 1)
    if (!REPO_PATTERN.test(repo) || repo.includes('..')) {
      throw new Error(`--source-ref "${value}": the repository must look like owner/repo.`)
    }
    if (!MOUNT_PATTERN.test(mountPath) || mountPath.split('/').some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
      throw new Error(`--source-ref "${value}": the mount path must be a relative lowercase slug path such as client-sdks/typescript (no leading slash, no "..").`)
    }
    for (const earlier of mappings) {
      if (earlier.repo.toLowerCase() === repo.toLowerCase()) throw new Error(`--source-ref: ${repo} is mapped twice.`)
      if (earlier.mountPath === mountPath || earlier.mountPath.startsWith(`${mountPath}/`) || mountPath.startsWith(`${earlier.mountPath}/`)) {
        throw new Error(`--source-ref: mount paths "${earlier.mountPath}" and "${mountPath}" overlap.`)
      }
    }
    mappings.push({ repo, mountPath })
  }
  return mappings
}

/** The directory holding a Mintlify docs.json: `docs/` first, then the repository root. */
export function findSourceRefDocsRoot(repositoryDir: string): string | null {
  for (const directory of [join(repositoryDir, 'docs'), repositoryDir]) {
    try {
      const config = join(directory, 'docs.json')
      if (lstatSync(directory).isSymbolicLink() || !lstatSync(config).isFile()) continue
      const parsed: unknown = JSON.parse(readFileSync(config, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'navigation' in parsed) return directory
    } catch {
      // Missing or unparseable: try the next candidate.
    }
  }
  return null
}

/**
 * Remove symlinks and dot-directories (the clone is disposable), then count.
 * Returns an error message when a cap is exceeded: the whole repository is
 * refused rather than imported partially.
 */
function sanitizeAndMeasure(root: string): { removedLinks: number; error?: string } {
  let files = 0
  let bytes = 0
  let removedLinks = 0
  const stack = [root]
  while (stack.length > 0) {
    const directory = stack.pop()!
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        unlinkSync(path)
        removedLinks++
      } else if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') rmSync(path, { recursive: true, force: true })
        else stack.push(path)
      } else if (entry.isFile()) {
        files++
        bytes += lstatSync(path).size
        if (files > SOURCE_REF_MAX_FILES) return { removedLinks, error: `it has more than ${SOURCE_REF_MAX_FILES} files` }
        if (bytes > SOURCE_REF_MAX_BYTES) return { removedLinks, error: `it is larger than ${SOURCE_REF_MAX_BYTES / 1_000_000} MB` }
      }
    }
  }
  return { removedLinks }
}

/** Prefix every root-absolute link/image/asset target in a page body with the mount path. */
export function prefixRootLinks(body: string, mountPath: string): string {
  const fix = (target: string): string => `/${mountPath}${target}`
  return replaceOutsideCodeAndComments(body, (text) => text
    .replace(/(\]\(<?)(\/(?!\/)[^\s)>]*)/g, (_match, before: string, target: string) => `${before}${fix(target)}`)
    .replace(/(\b(?:href|src|to|poster)=(['"]))(\/(?!\/)[^'"\n]*)\2/g, (_match, before: string, quote: string, target: string) => `${before}${fix(target)}${quote}`)
    .replace(/^(\[[^\]\n]+\]:[ \t]*<?)(\/(?!\/)\S*)/gm, (_match, before: string, target: string) => `${before}${fix(target)}`))
}

function prefixNavigation(
  entries: Array<string | MigrationNavigationGroup>,
  mountPath: string,
): Array<string | MigrationNavigationGroup> {
  return entries.map((entry) => typeof entry === 'string'
    ? `${mountPath}/${entry}`
    : { ...entry, pages: prefixNavigation(entry.pages, mountPath) })
}

/** Tabs flatten into groups (one tab: its entries directly); group structure is kept. */
function flattenTabs(config: MigrationDocsConfig): Array<string | MigrationNavigationGroup> {
  const tabs = config.tabs.filter((tab) => !tab.api)
  const entriesOf = (tab: (typeof tabs)[number]): Array<string | MigrationNavigationGroup> => [...(tab.pages ?? []), ...(tab.groups ?? [])]
  if (tabs.length === 1) return entriesOf(tabs[0])
  return tabs.flatMap((tab) => {
    const pages = entriesOf(tab)
    return pages.length === 0 ? [] : [{ group: tab.displayLabel ?? tab.tab, ...(tab.icon ? { icon: tab.icon } : {}), pages }]
  })
}

function empty(mapping: SourceRefMapping, message: string): SourceRefImport {
  return { ...mapping, pages: [], assets: [], navigation: [], warnings: [{ code: 'skipped-file', message: `sourceRef ${mapping.repo} was not imported: ${message}` }] }
}

/**
 * Import one cloned referenced repository as a sub-site under its mount path.
 * `repositoryDir` is a disposable clone: symlinks and dot-directories under
 * its docs root are deleted.
 */
export function importSourceRef(mapping: SourceRefMapping, repositoryDir: string): SourceRefImport {
  const docsRoot = findSourceRefDocsRoot(repositoryDir)
  if (!docsRoot) return empty(mapping, 'no Mintlify docs.json was found in docs/ or at the repository root.')
  const realRoot = realpathSync(docsRoot)
  const fromClone = relative(realpathSync(repositoryDir), realRoot)
  if (fromClone === '..' || fromClone.startsWith(`..${sep}`) || isAbsolute(fromClone)) return empty(mapping, 'its docs directory resolves outside the repository.')
  const measured = sanitizeAndMeasure(realRoot)
  if (measured.error) return empty(mapping, `${measured.error}, over the per-repository limit. Nothing was imported.`)

  const bundle = migrateRepository({
    repositoryDir: realRoot,
    sourceUrl: `https://github.com/${mapping.repo}`,
    docsDir: '',
    platform: 'mintlify',
  })
  const prefix = (message: string): string => `[${mapping.repo}] ${message}`
  const warnings: Array<MigrationWarning> = bundle.warnings.filter((warning) => !/dashboard access settings/i.test(warning.message)).slice(0, MAX_FORWARDED_WARNINGS).map((warning) => ({ ...warning, message: prefix(warning.message) }))
  if (bundle.warnings.length > MAX_FORWARDED_WARNINGS) {
    warnings.push({ code: 'unsupported-config', message: prefix(`${bundle.warnings.length - MAX_FORWARDED_WARNINGS} more migration warnings were omitted.`) })
  }
  if (measured.removedLinks > 0) warnings.push({ code: 'skipped-file', message: prefix(`${measured.removedLinks} symbolic link(s) were ignored.`) })
  const dropped = [
    bundle.remoteApiSpecs?.length ? 'remote OpenAPI specs' : '',
    bundle.assets.some((asset) => asset.projectRelative) ? 'local OpenAPI specs' : '',
    bundle.componentFiles?.length ? 'custom components' : '',
    bundle.quarantinedFiles?.length || bundle.droppedGatedPages ? 'access-restricted pages' : '',
  ].filter(Boolean)
  if (dropped.length > 0) warnings.push({ code: 'unsupported-config', message: prefix(`Not imported: ${dropped.join(', ')}.`) })

  const mounted = (id: string): string => `${mapping.mountPath}/${id}`
  const pages = bundle.pages.filter((page) => !page.openapi).map((page) => ({
    ...page,
    id: mounted(page.id),
    navigationId: mounted(page.navigationId),
    body: prefixRootLinks(page.body, mapping.mountPath),
  }))
  const openApiPages = bundle.pages.length - pages.length
  if (openApiPages > 0) warnings.push({ code: 'skipped-file', message: prefix(`${openApiPages} page(s) bound to an OpenAPI operation were skipped.`) })
  const assets = bundle.assets.filter((asset) => !asset.projectRelative).map((asset) => ({ ...asset, path: mounted(asset.path) }))
  return { ...mapping, pages, assets, navigation: prefixNavigation(flattenTabs(bundle.docsConfig), mapping.mountPath), warnings }
}

/** True when the main site already owns the mount path (a directory or a same-named page file). */
export function sourceRefMountCollides(siteRoot: string, mountPath: string): boolean {
  const target = resolve(siteRoot, mountPath)
  return [target, `${target}.md`, `${target}.mdx`].some((candidate) => {
    try {
      lstatSync(candidate)
      return true
    } catch {
      return false
    }
  })
}
