/**
 * Repository adapter for the shared migration engine. Traversal is bounded;
 * `scanFiles` follows a symbolic link only when its resolved real path stays
 * inside the repository checkout (this covers a submodule mounted as a
 * symlink, e.g. Oasis's `docs/core -> ../external/oasis-core/docs`) and
 * guards against a cycle, but every other directory walk in this file still
 * skips symlinks outright. Git is always invoked with an argument array so
 * source-controlled branch names can never become shell commands.
 */

import { compileSync } from '@mdx-js/mdx'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve as resolvePath, sep } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { createComponentMigrator, declarationsReferenceBrowserGlobal, hasAnyFunctionValuedProp, propsTargetExtractedClientComponent } from './components.js'

import {
  projectDocusaurusNavigation,
  readDocusaurusBrandAssetPaths,
  readDocusaurusRedirects,
  readDocusaurusSidebars,
  readDocusaurusThemeColor,
  rewriteDocusaurusLinks,
  resolveDocusaurusPageIdentity,
  type DocusaurusPageDescriptor,
  type DocusaurusSidebars,
} from './docusaurus.js'
import type { FernApiSection } from './fern.js'
import { projectFernNavigation, readFernConfig } from './fern.js'
import { escapeFernLiteralBraces, functionDeclaredNames, parseMarkdownPage, protectMathBlocks, replaceLinkWithAnchor, replaceUnknownComponents } from './mdx.js'
import {
  addMintlifyDirectoryRedirects,
  addMintlifyHomepageRedirects,
  buildNavigationFromPages,
  isDocumentationExtension,
  mintlifyNavigationApiReferences,
  projectMintlifyNavigation,
  pruneMissingNavigationPages,
  readMintlifyConfig,
  type MintlifyApiSpecReference,
} from './navigation.js'
import {
  normalizeAssetPath,
  mintlifyLocalizedReference,
  pageIdFromReference,
  resolveWithin,
  resolveWithinRoot,
  trimEdgeSlashes,
  trimTrailingSlashes,
} from './path.js'
import type {
  MigrationAsset,
  MigrationBundle,
  MigrationDocsConfig,
  MigrationNavigationGroup,
  MigrationPage,
  MigrationPlatform,
  MigrationWarning,
} from './types.js'

const MAX_SOURCE_FILES = 5_000
const MAX_PAGE_BYTES = 2_000_000
const MAX_ASSET_BYTES = 25_000_000
const MAX_TOTAL_ASSET_BYTES = 500_000_000
/** A Git LFS pointer file's fixed opening line (the smudge filter replaces this with the real binary; skipping it during clone leaves this text in place). */
const GIT_LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

/** A small text file starting with the fixed Git LFS pointer line, not real asset content. */
function isGitLfsPointer(content: Buffer): boolean {
  return content.length < 1024 && content.toString('utf8', 0, GIT_LFS_POINTER_PREFIX.length) === GIT_LFS_POINTER_PREFIX
}
const IGNORED_DIRECTORIES = new Set([
  '.git', '.github', '.next', '.turbo', '.vercel', '.vscode',
  'node_modules', 'dist', 'build', 'coverage',
])
const ASSET_DIRECTORIES = new Set(['assets', 'images', 'img', 'media', 'public', 'static'])
const ASSET_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4',
  '.pdf', '.png', '.svg', '.webm', '.webp',
])
const REPOSITORY_ONLY_DOCUMENTS = new Set([
  'agents.md', 'claude.md', 'code_of_conduct.md', 'contributing.md',
  'license.md', 'readme.md', 'security.md',
])
const SNIPPET_DIRECTORIES = new Set(['snippets', '_snippets', 'partials', '_partials'])
// Matches a default import (`import Name from '...'`), a default-as-named
// import (`import { default as Name } from '...'`), and a plain named import
// (`import { Name } from '...'`) — Mintlify snippets can export either way.
const SNIPPET_IMPORT_PATTERN = /^import\s+(?:\{\s*(?:default\s+as\s+)?([A-Z][A-Za-z0-9_]*)\s*\}|([A-Z][A-Za-z0-9_]*))\s+from\s+['"]([^'"]+\.mdx?)['"]\s*;?(?:\s*\/\/.*)?$/gm

/**
 * Mintlify's `<Snippet file="path.mdx" />` tag form: unlike the import form
 * above, this never needs a matching `import` statement — `file` is a path
 * relative to the project's `snippets/` directory (Mintlify's own
 * convention; see `resolveSnippetPath`'s sibling below for the actual
 * lookup). Both self-closing and paired spellings are matched; a paired
 * tag's own children (if any) are always discarded in favor of the
 * resolved snippet's real content, matching Mintlify's own renderer.
 */
const SNIPPET_TAG_PATTERN = /<Snippet\s+file=(?:"([^"]+)"|'([^']+)')\s*(?:\/>|>[\s\S]*?<\/Snippet>)/g
const MINTIGNORE_FILENAME = '.mintignore'
interface IgnoreMatcher {
  add(patterns: string): IgnoreMatcher
  ignores(pathname: string): boolean
}
// `ignore`'s CJS default export is mistyped under NodeNext module resolution
// (the default import resolves to the whole module namespace); load it
// through `require` and type it locally instead of fighting the interop.
const createIgnoreMatcher = createRequire(import.meta.url)('ignore') as () => IgnoreMatcher

/** Dotfile directories (`.tooling`, `.vale`, tool/editor config, ...) never hold docs pages. */
function isIgnoredDirectory(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRECTORIES.has(name)
}

const OPENAPI_FILENAMES = new Set([
  'openapi.json', 'openapi.yaml', 'openapi.yml',
  'swagger.json', 'swagger.yaml', 'swagger.yml',
])

export interface GitHubRepositorySource {
  owner: string
  repo: string
  branch: string
  docsDir: string
  cloneUrl: string
}

export interface RepositoryMigrationOptions {
  repositoryDir: string
  sourceUrl: string
  docsDir?: string
  platform?: MigrationPlatform
  /** @internal Prefix used by additional Docusaurus docs-plugin instances. */
  docusaurusRoutePrefix?: string
  /** @internal Prevent recursive discovery while importing one plugin root. */
  docusaurusSkipPlugins?: boolean
  /** @internal Additional docs plugins default to autogenerated navigation. */
  docusaurusSkipSidebar?: boolean
  /** @internal Static assets are shared across docs-plugin instances. */
  docusaurusSkipAssets?: boolean
  /** @internal Redirects are global config, read once, not per plugin instance. */
  docusaurusSkipRedirects?: boolean
}

interface DocusaurusPluginRoot {
  docsDir: string
  routePrefix: string
}

const DOCUSAURUS_CONFIG_FILENAMES = [
  'docusaurus.config.js',
  'docusaurus.config.ts',
  'docusaurus.config.mjs',
]

function hasDocusaurusConfig(directory: string): boolean {
  return DOCUSAURUS_CONFIG_FILENAMES.some((filename) => {
    const path = resolveWithin(directory, filename)
    return existsSync(path) && lstatSync(path).isFile()
  })
}

function hasMintlifyConfig(directory: string): boolean {
  return ['docs.json', 'mint.json'].some((filename) => {
    const path = resolveWithin(directory, filename)
    if (!existsSync(path) || !lstatSync(path).isFile()) return false
    if (filename === 'mint.json') return true
    try {
      const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      return String(config.$schema ?? '').includes('mintlify') || 'navigation' in config
    } catch {
      return false
    }
  })
}

/**
 * Recursively counts `.md`/`.mdx` files under `directory` (skipping
 * ignored/symlinked directories, same as the root-finding BFS above), for
 * ranking two candidate project roots against each other. Bounded so a huge
 * false-positive candidate (e.g. `node_modules` slipping past
 * `isIgnoredDirectory`) can't make root detection itself slow.
 */
function countMarkdownPages(directory: string, limit = 20_000): number {
  let count = 0
  const stack: Array<string> = [directory]
  while (stack.length > 0 && count < limit) {
    const current = stack.pop()!
    let entries: Array<Dirent>
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) stack.push(resolveWithin(current, entry.name))
      } else if (/\.mdx?$/i.test(entry.name)) {
        count++
      }
    }
  }
  return count
}

/**
 * Multiple config files can each look like a valid project root in the same
 * repository (Infisical ships both a top-level `company/mint.json` handbook
 * and `docs/docs.json`, the real docs). Picking the first one a breadth-
 * first walk happens to reach silently imports the wrong, usually much
 * smaller, site. Rank every candidate instead: `docs.json` before
 * `mint.json` (Mintlify's own current format), then a directory literally
 * named `docs`, then whichever has the most actual content — and warn
 * whenever there was more than one candidate, so a wrong guess is visible
 * and `--docs-dir` is offered as the fix, even when the ranking picked the
 * one the caller actually wanted.
 */
function pickPreferredDocsRoot(
  candidates: Array<string>,
  repositoryDir: string,
  platformLabel: string,
  warnings: Array<MigrationWarning> | undefined,
  rank?: (directory: string) => number,
): string {
  const ranked = [...candidates].sort((left, right) => {
    const byRank = (rank?.(right) ?? 0) - (rank?.(left) ?? 0)
    if (byRank !== 0) return byRank
    const byName = (basename(right) === 'docs' ? 1 : 0) - (basename(left) === 'docs' ? 1 : 0)
    if (byName !== 0) return byName
    return countMarkdownPages(right) - countMarkdownPages(left)
  })
  const winner = ranked[0]
  if (candidates.length > 1 && warnings) {
    const relativePaths = candidates.map((candidate) => relative(repositoryDir, candidate) || '.')
    warnings.push({
      code: 'unsupported-config',
      message: `Multiple possible ${platformLabel} project roots were found (${relativePaths.join(', ')}); `
        + `${relative(repositoryDir, winner) || '.'} was picked. Pass --docs-dir to choose a different one if this is wrong.`,
      source: '.',
    })
  }
  return winner
}

function findMintlifyProjectRoot(repositoryDir: string, docsDir?: string, warnings?: Array<MigrationWarning>): string | null {
  if (docsDir !== undefined) {
    let candidate = trimTrailingSlashes(docsDir)
    while (true) {
      const path = resolveWithin(repositoryDir, candidate || '.')
      if (hasMintlifyConfig(path)) return path
      if (!candidate) break
      const parent = dirname(candidate)
      candidate = parent === '.' ? '' : parent
    }
  }
  const candidates: Array<string> = []
  const queue: Array<{ directory: string; depth: number }> = [{ directory: repositoryDir, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!
    visited++
    if (hasMintlifyConfig(current.directory)) candidates.push(current.directory)
    if (current.depth >= 4) continue
    for (const entry of readdirSync(current.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || isIgnoredDirectory(entry.name)) continue
      queue.push({ directory: resolveWithin(current.directory, entry.name), depth: current.depth + 1 })
    }
  }
  if (candidates.length === 0) return null
  return pickPreferredDocsRoot(candidates, repositoryDir, 'Mintlify', warnings, (directory) => (
    existsSync(resolveWithin(directory, 'docs.json')) ? 1 : 0
  ))
}

function hasFernConfig(directory: string): boolean {
  return ['docs.yml', 'fern.config.json'].every((filename) => {
    const path = resolveWithin(directory, filename)
    return existsSync(path) && lstatSync(path).isFile()
  })
}

function findFernProjectRoot(repositoryDir: string, docsDir?: string): string | null {
  if (docsDir !== undefined) {
    let candidate = trimTrailingSlashes(docsDir)
    while (true) {
      const path = resolveWithin(repositoryDir, candidate || '.')
      if (hasFernConfig(path)) return path
      if (!candidate) break
      const parent = dirname(candidate)
      candidate = parent === '.' ? '' : parent
    }
  }
  const queue: Array<{ directory: string; depth: number }> = [{ directory: repositoryDir, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!
    visited++
    if (hasFernConfig(current.directory)) return current.directory
    if (current.depth >= 4) continue
    for (const entry of readdirSync(current.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || isIgnoredDirectory(entry.name)) continue
      queue.push({ directory: resolveWithin(current.directory, entry.name), depth: current.depth + 1 })
    }
  }
  return null
}

function findDocusaurusProjectRoot(repositoryDir: string, docsDir?: string, warnings?: Array<MigrationWarning>): string | null {
  if (docsDir !== undefined) {
    let candidate = trimTrailingSlashes(docsDir)
    while (true) {
      const path = resolveWithin(repositoryDir, candidate || '.')
      if (hasDocusaurusConfig(path)) return path
      if (!candidate) break
      const parent = dirname(candidate)
      candidate = parent === '.' ? '' : parent
    }
  }

  const candidates: Array<string> = []
  const queue: Array<{ directory: string; depth: number }> = [{ directory: repositoryDir, depth: 0 }]
  let visited = 0
  while (queue.length > 0 && visited < 500) {
    const current = queue.shift()!
    visited++
    if (hasDocusaurusConfig(current.directory)) candidates.push(current.directory)
    if (current.depth >= 4) continue
    for (const entry of readdirSync(current.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || isIgnoredDirectory(entry.name)) continue
      queue.push({
        directory: resolveWithin(current.directory, entry.name),
        depth: current.depth + 1,
      })
    }
  }
  if (candidates.length === 0) return null
  return pickPreferredDocsRoot(candidates, repositoryDir, 'Docusaurus', warnings)
}

function readDocusaurusConfigSource(projectRoot: string): string {
  const path = DOCUSAURUS_CONFIG_FILENAMES
    .map((filename) => resolveWithin(projectRoot, filename))
    .find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile())
  if (!path || lstatSync(path).size > 1_000_000) return ''
  return readFileSync(path, 'utf8')
}

function primaryDocusaurusDocsDirectory(projectRoot: string): string {
  const source = readDocusaurusConfigSource(projectRoot)
  const configured = source.match(/\bdocs\s*:\s*\{[\s\S]{0,4000}?\bpath\s*:\s*(['"])([^'"]+)\1/)?.[2]
  return trimTrailingSlashes(configured?.replace(/^\.\//, '') ?? '') || 'docs'
}

function additionalDocusaurusPluginRoots(
  repositoryDir: string,
  projectRoot: string,
  warnings: Array<MigrationWarning>,
): Array<DocusaurusPluginRoot> {
  const source = readDocusaurusConfigSource(projectRoot)
  const plugins: Array<DocusaurusPluginRoot> = []
  const matcher = /['"]@docusaurus\/plugin-content-docs['"][\s\S]{0,3000}?\bpath\s*:\s*(['"])([^'"]+)\1[\s\S]{0,1000}?\brouteBasePath\s*:\s*(['"])([^'"]+)\3/g
  for (const match of source.matchAll(matcher)) {
    const localPath = trimTrailingSlashes(match[2].replace(/^\.\//, ''))
    const routePrefix = trimEdgeSlashes(match[4])
    if (!localPath || !routePrefix) continue
    // Docusaurus resolves a content-docs instance's `path` relative to the
    // site directory (where `docusaurus.config` lives, `projectRoot` here).
    // Some monorepo sites build by copying that project root's contents up
    // into the repository root before running the generator (Playwright's
    // own `cp -r nodejs/* .` step is a real example — see the identical
    // fallback in components.ts's `resolveDependency`), so a `path` that
    // isn't found under `projectRoot` is retried directly under
    // `repositoryDir`, still confined to the repository.
    let docsDir: string | undefined
    for (const base of [projectRoot, repositoryDir]) {
      let absolute: string
      try {
        absolute = resolveWithin(base, localPath)
      } catch {
        continue
      }
      if (existsSync(absolute) && lstatSync(absolute).isDirectory()) {
        docsDir = relative(repositoryDir, absolute).replace(/\\/g, '/')
        break
      }
    }
    if (docsDir) {
      plugins.push({ docsDir, routePrefix })
    } else {
      warnings.push({
        code: 'unsupported-config',
        message: `The "${routePrefix}" docs plugin instance's path (${JSON.stringify(match[2])}) could not be found in the repository and was skipped.`,
      })
    }
  }
  return plugins
}

/** Parse and validate a public GitHub repository URL. */
export function parseGitHubRepositoryUrl(rawUrl: string): GitHubRepositorySource {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid GitHub URL: ${rawUrl}`)
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Repository migrations require an https://github.com URL.')
  }
  if (url.username || url.password || url.port) {
    throw new Error('GitHub repository URLs cannot include credentials or custom ports.')
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, rawRepo] = segments
  const repo = rawRepo?.replace(/\.git$/i, '')
  const safeName = /^[A-Za-z0-9_.-]+$/
  if (!owner || !repo || !safeName.test(owner) || !safeName.test(repo)) {
    throw new Error('GitHub URL must include a valid owner and repository name.')
  }
  let branch = 'HEAD'
  let docsDir = ''
  if (segments[2] === 'tree' && segments[3]) {
    branch = segments[3]
    docsDir = segments.slice(4).join('/')
  }
  return {
    owner,
    repo,
    branch,
    docsDir,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  }
}

const CLONE_RETRY_ATTEMPTS = 3
const CLONE_RETRY_DELAY_MS = 1_000
const DEFAULT_CLONE_TIMEOUT_MS = 10 * 60_000

/** Transient network-class git failures a retry can plausibly recover from. Also covers this module's own timeout error below. */
const RETRYABLE_CLONE_ERROR = /RPC failed|Recv failure|early EOF|curl \d+|Could not resolve host|Connection (?:reset|refused|timed out)|The remote end hung up|SSL[_ ]?(?:read|connect|write) error|timed out|network is unreachable/i

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** How long a single git subprocess may run before it's killed and treated as a (retryable) timeout. Configurable since a very large repository on a slow link may need longer than the generous 10-minute default. */
function gitProcessTimeoutMs(): number {
  const raw = process.env.THALLY_MIGRATE_CLONE_TIMEOUT_MS
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLONE_TIMEOUT_MS
}

/**
 * Run one git subprocess without a shell, with an overall timeout (a
 * stalled clone/fetch otherwise hangs forever — there is no `timeout`
 * binary to rely on) and per-process env overrides (never touching global
 * git/npm config, per this package's own rule).
 */
function runGit(args: Array<string>, options: { cwd?: string; env?: Record<string, string>; label: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...options.env },
    })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, gitProcessTimeoutMs())
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else if (timedOut) reject(new Error(`${options.label} timed out after ${gitProcessTimeoutMs()}ms and was killed.`))
      else reject(new Error(`${options.label}: ${stderr.trim() || `git exited ${code}`}`))
    })
  })
}

/**
 * Neutralize the `filter.lfs.*` smudge/clean/process filter driver for one
 * git process only — never the user's global git config — so a repository
 * tracked with Git LFS still clones when the host has no `git-lfs` binary.
 * `GIT_LFS_SKIP_SMUDGE=1` alone isn't enough: if this host ever had
 * `git lfs install` run and then had the `git-lfs` binary removed (as here),
 * `filter.lfs.smudge`/`.process` are still registered in the *global* git
 * config pointing at a command that no longer exists, and
 * `GIT_LFS_SKIP_SMUDGE` is only ever read by that (missing) binary — git
 * itself still fails outright trying to invoke it. `GIT_CONFIG_COUNT`/
 * `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` env pairs are the one config
 * source with higher precedence than the user's global config, so they can
 * override it per-process: `smudge`/`clean` become `cat` (pass the LFS
 * pointer text straight through — real content was never fetched anyway)
 * and `process` is cleared so git falls back to them; `filter.lfs.required
 * = false` keeps a filter hiccup on one path (an oversized fixture, say)
 * from failing the whole checkout. The result is the repository's own
 * files, with an LFS-tracked asset left as its pointer text — the
 * asset-copying step below warns when a copied file turns out to be one.
 */
const LFS_FILTER_OVERRIDE_ENV: Record<string, string> = {
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'filter.lfs.smudge',
  GIT_CONFIG_VALUE_0: 'cat',
  GIT_CONFIG_KEY_1: 'filter.lfs.clean',
  GIT_CONFIG_VALUE_1: 'cat',
  GIT_CONFIG_KEY_2: 'filter.lfs.process',
  GIT_CONFIG_VALUE_2: '',
  GIT_CONFIG_KEY_3: 'filter.lfs.required',
  GIT_CONFIG_VALUE_3: 'false',
}

function cloneOnce(source: GitHubRepositorySource, targetDir: string): Promise<void> {
  // Submodules are deliberately not recursed here: `--recurse-submodules`
  // fails the *entire* clone if any one submodule can't be fetched (a
  // private or since-deleted submodule shouldn't take the whole migration
  // down). `initSubmodules`, run after a successful plain clone, is the
  // equivalent of `--recurse-submodules --shallow-submodules` (`--depth 1`
  // per submodule) but fault-tolerant per submodule.
  const args = ['clone', '--depth', '1', '--single-branch']
  if (source.branch !== 'HEAD') args.push('--branch', source.branch)
  args.push('--', source.cloneUrl, targetDir)
  return runGit(args, {
    label: `Failed to clone ${source.owner}/${source.repo}`,
    env: LFS_FILTER_OVERRIDE_ENV,
  })
}

/** Every submodule path declared in a cloned repository's `.gitmodules`, in file order. */
export function gitmodulePaths(targetDir: string): Array<string> {
  const gitmodulesPath = resolvePath(targetDir, '.gitmodules')
  if (!existsSync(gitmodulesPath) || !lstatSync(gitmodulesPath).isFile()) return []
  let content: string
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch {
    return []
  }
  return [...content.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => match[1]).filter(Boolean)
}

/**
 * Every submodule `url` in a cloned repository's `.gitmodules`, in the same
 * file order as `gitmodulePaths` (each `[submodule "..."]` block declares
 * `path` and `url` once, so index `i` here corresponds to index `i` there).
 */
function gitmoduleUrls(targetDir: string): Array<string> {
  const gitmodulesPath = resolvePath(targetDir, '.gitmodules')
  if (!existsSync(gitmodulesPath) || !lstatSync(gitmodulesPath).isFile()) return []
  let content: string
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch {
    return []
  }
  return [...content.matchAll(/^\s*url\s*=\s*(.+?)\s*$/gm)].map((match) => match[1]).filter(Boolean)
}

/**
 * `--recurse-submodules` on the main clone (above) fails the *entire* clone
 * if any one submodule can't be fetched, which is worse than not having
 * that submodule's content at all. So the main clone omits it and this
 * best-effort pass follows, per submodule path, so one broken/private
 * submodule doesn't take down the whole migration — it's just missing,
 * and named in a warning instead of silently absent.
 */
async function initSubmodules(targetDir: string, warnings: Array<MigrationWarning>): Promise<void> {
  const paths = gitmodulePaths(targetDir)
  if (paths.length === 0) return
  const urls = gitmoduleUrls(targetDir)
  const failed: Array<string> = []
  for (const [index, path] of paths.entries()) {
    // A path or url beginning with `-` would be read as a git option
    // rather than a pathspec/URL once it reaches argv (even after `--`,
    // git's own pathspec parser treats a leading `-` as a flag), and
    // `.gitmodules` is attacker-controlled content from the cloned repo.
    if (path.startsWith('-') || (urls[index]?.startsWith('-') ?? false)) {
      failed.push(path)
      continue
    }
    try {
      await runGit([
        '-c', 'protocol.file.allow=never',
        '-c', 'protocol.ext.allow=never',
        'submodule', 'update', '--init', '--depth', '1', '--', path,
      ], {
        cwd: targetDir,
        env: LFS_FILTER_OVERRIDE_ENV,
        label: `Failed to initialize submodule ${path}`,
      })
    } catch {
      failed.push(path)
    }
  }
  if (failed.length > 0) {
    warnings.push({
      code: 'fetch-failed',
      message: `${failed.length} git submodule${failed.length === 1 ? '' : 's'} could not be fetched and ${failed.length === 1 ? 'is' : 'are'} missing from the migrated content: ${failed.join(', ')}.`,
    })
  }
}

/**
 * Clone a repository without a shell; callers own and remove `targetDir`. A
 * large repository on a flaky connection can drop mid-clone (`RPC failed`,
 * `Recv failure`, a `curl 56`, …) — retry a network-class failure a couple
 * of times with backoff instead of surfacing a hard failure on the first
 * blip. A partial checkout from the failed attempt is removed first, or
 * `git clone` refuses to reuse the (now non-empty) target directory. A
 * stalled clone/submodule-init is killed by `runGit`'s own timeout, which
 * surfaces as a retryable error. `warnings`, if given, collects a
 * submodule-fetch-failure warning (this function otherwise returns exactly
 * as before, so existing callers are unaffected).
 */
export async function cloneGitHubRepository(
  source: GitHubRepositorySource,
  targetDir: string,
  warnings?: Array<MigrationWarning>,
): Promise<void> {
  for (let attempt = 1; attempt <= CLONE_RETRY_ATTEMPTS; attempt++) {
    try {
      await cloneOnce(source, targetDir)
      await initSubmodules(targetDir, warnings ?? [])
      return
    } catch (error) {
      const retryable = error instanceof Error && RETRYABLE_CLONE_ERROR.test(error.message)
      if (!retryable || attempt === CLONE_RETRY_ATTEMPTS) throw error
      rmSync(targetDir, { recursive: true, force: true })
      await delay(CLONE_RETRY_DELAY_MS * attempt)
    }
  }
}

/** Detect a supported repository docs platform from unambiguous config files. */
export function detectRepositoryPlatform(repositoryDir: string, docsDir?: string): MigrationPlatform {
  if (findMintlifyProjectRoot(repositoryDir, docsDir)) return 'mintlify'
  if (findFernProjectRoot(repositoryDir, docsDir)) return 'fern'
  const selectedRoot = docsDir === undefined ? repositoryDir : resolveWithin(repositoryDir, docsDir || '.')
  const docsJson = resolveWithin(selectedRoot, 'docs.json')
  if (existsSync(docsJson)) {
    try {
      const config = JSON.parse(readFileSync(docsJson, 'utf8')) as Record<string, unknown>
      if (Array.isArray(config.tabs)) return 'thally'
    } catch {
      // A malformed source config is reported later; platform detection falls through.
    }
  }
  if (['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'docusaurus'
  if (findDocusaurusProjectRoot(repositoryDir)) return 'docusaurus'
  if (existsSync(resolveWithin(repositoryDir, 'SUMMARY.md'))) return 'gitbook'
  if (existsSync(resolveWithin(repositoryDir, '.vitepress'))) return 'vitepress'
  if (['astro.config.mjs', 'astro.config.ts']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'starlight'
  if (['pages/_meta.json', '_meta.json']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'nextra'
  return 'unknown'
}

function containsMarkdown(directory: string, depth = 0): boolean {
  if (depth > 4) return false
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (isIgnoredDirectory(entry.name) || entry.isSymbolicLink()) continue
    const path = resolveWithin(directory, entry.name)
    if (entry.isFile() && ['.md', '.mdx'].includes(extname(entry.name).toLowerCase())) return true
    if (entry.isDirectory() && containsMarkdown(path, depth + 1)) return true
  }
  return false
}

/** Pick the first conventional content root containing Markdown. */
export function detectRepositoryDocsDir(repositoryDir: string): string {
  for (const candidate of ['docs', 'documentation', 'content', 'pages', 'src/content', 'src/pages', 'guide', 'guides', '']) {
    const path = resolveWithin(repositoryDir, candidate)
    if (existsSync(path) && lstatSync(path).isDirectory() && containsMarkdown(path)) return candidate
  }
  return ''
}

interface ScannedFile {
  absolutePath: string
  relativePath: string
}

/**
 * Scan `root` for its files, following a symbolic link only when its
 * resolved real path stays inside `confinementRoot` (default `root`) — this
 * is how a submodule mounted as a symlink (Oasis's `docs/core ->
 * ../external/oasis-core/docs`, `docs/adrs -> ../external/adrs`) actually
 * gets its content walked, since a plain `git clone` (even with submodules
 * initialized) leaves those as real symlinks on disk that a naive walk
 * would otherwise always skip. `confinementRoot` is normally the whole
 * repository checkout, not just the docs root, because a submodule commonly
 * links out to a sibling directory outside it. `visitedRealPaths` guards
 * against a cycle (a symlink pointing at an ancestor, or two symlinks
 * pointing at each other).
 */
function scanFiles(root: string, confinementRoot: string = root): Array<ScannedFile> {
  const files: Array<ScannedFile> = []
  let confinementReal: string
  try {
    confinementReal = realpathSync(confinementRoot)
  } catch {
    confinementReal = confinementRoot
  }
  // Tracks every directory's real path, symlinked or not: a symlink into an
  // ancestor (or two symlinks pointing at each other) must not recurse
  // forever, and this also cheaply dedupes reaching the same real directory
  // through two different symlinks.
  const visitedRealPaths = new Set<string>()
  // `directory` is the real, physical path a symlink was already resolved
  // to (used for readdirSync/realpathSync); `logicalDirectory` is the path
  // as seen through the symlink from `root` (used only for `relativePath`,
  // so a page inside a symlinked submodule gets a sensible id like
  // `core/overview` instead of a `../../..`-laden physical path).
  function visit(directory: string, logicalDirectory: string = directory): void {
    if (files.length >= MAX_SOURCE_FILES) return
    let directoryReal: string
    try {
      directoryReal = realpathSync(directory)
    } catch {
      return
    }
    if (visitedRealPaths.has(directoryReal)) return
    visitedRealPaths.add(directoryReal)
    let entries: Array<Dirent>
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_SOURCE_FILES) return
      if (isIgnoredDirectory(entry.name)) continue
      const path = resolveWithin(directory, entry.name)
      const logicalPath = resolveWithin(logicalDirectory, entry.name)
      if (entry.isSymbolicLink()) {
        let real: string
        try {
          real = realpathSync(path)
        } catch {
          continue // A broken symlink (e.g. an uninitialized submodule) has nothing to walk.
        }
        const withinConfinement = real === confinementReal || real.startsWith(`${confinementReal}${sep}`)
        if (!withinConfinement) continue
        let target: ReturnType<typeof statSync>
        try {
          target = statSync(real)
        } catch {
          continue
        }
        if (target.isDirectory()) visit(real, logicalPath)
        else if (target.isFile()) files.push({ absolutePath: real, relativePath: relative(root, logicalPath).replace(/\\/g, '/') })
        continue
      }
      if (entry.isDirectory()) visit(path, logicalPath)
      else if (entry.isFile()) files.push({ absolutePath: path, relativePath: relative(root, logicalPath).replace(/\\/g, '/') })
    }
  }
  visit(root)
  return files
}

/**
 * Mintlify excludes paths from the docs site with a gitignore-style
 * `.mintignore` at the project root (see Mintlify's docs). Honoring it keeps
 * internal tooling directories like `agent-context/` out of the migration
 * even though they aren't dotfile directories.
 */
function readMintignoreMatcher(mintlifyRoot: string): IgnoreMatcher | null {
  const path = resolveWithin(mintlifyRoot, MINTIGNORE_FILENAME)
  if (!existsSync(path) || !lstatSync(path).isFile()) return null
  return createIgnoreMatcher().add(readFileSync(path, 'utf8'))
}

/**
 * Compile-check a page body with the same MDX compiler the scaffold's
 * runtime build uses (`@mdx-js/mdx`). A single malformed page must never
 * abort `scripts/build-runtime-sources.mts` for the whole project, so
 * migration excludes it up front instead and reports why.
 */
function invalidMdxReason(body: string): string | null {
  try {
    compileSync(body, { outputFormat: 'program' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Extract Mintlify's `colors.{primary,light,dark}` theme hexes, if valid. */
function mintlifyThemeColors(value: unknown): { primary?: string; light?: string; dark?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const colors: { primary?: string; light?: string; dark?: string } = {}
  for (const key of ['primary', 'light', 'dark'] as const) {
    if (typeof source[key] === 'string' && HEX_COLOR.test(source[key])) colors[key] = source[key]
  }
  return Object.keys(colors).length > 0 ? colors : undefined
}

/**
 * Extract Fern's `colors.accent-primary` (a hex string, or `{light, dark}`),
 * if valid. Fern's `light`/`dark` are normal (each names the mode it
 * paints), unlike Mintlify's inverted schema that `site.colors` otherwise
 * follows, so they're swapped onto Mintlify's `{light, dark}` keys here to
 * give downstream consumers (`updateSiteConfig`) one consistent contract.
 */
function fernThemeColors(value: unknown): { primary?: string; light?: string; dark?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const accent = (value as Record<string, unknown>)['accent-primary']
  if (typeof accent === 'string') return HEX_COLOR.test(accent) ? { primary: accent } : undefined
  if (!accent || typeof accent !== 'object') return undefined
  const source = accent as Record<string, unknown>
  const lightMode = typeof source.light === 'string' && HEX_COLOR.test(source.light) ? source.light : undefined
  const darkMode = typeof source.dark === 'string' && HEX_COLOR.test(source.dark) ? source.dark : undefined
  const colors: { light?: string; dark?: string } = {}
  if (darkMode) colors.light = darkMode
  if (lightMode) colors.dark = lightMode
  return Object.keys(colors).length > 0 ? colors : undefined
}

/**
 * Mintlify's `logo`/`favicon` config value is a plain path, or an object
 * with `light`/`dark` (and sometimes `href`, which is a link, not an asset)
 * variants. The referenced files are already copied to `public/` by the
 * ordinary asset scan (they live under the docs tree); only wiring them into
 * the rendered site's actual branding is unsupported (see the warning this
 * feeds — `SiteConfig` has no static logo/favicon field at all, unlike
 * `brand`/`brandPreset`, which the color pipeline above already wires), so
 * this only names them for that warning.
 */
function mintlifyBrandAssetPaths(value: unknown): Array<string> {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  const source = value as Record<string, unknown>
  return (['light', 'dark'] as const)
    .map((key) => source[key])
    .filter((entry): entry is string => typeof entry === 'string')
}

function normalizedReferenceKey(value: string): string {
  return value.split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\.(?:mdx?|rst|txt)$/i, '')
    .replace(/\/(?:index|readme)$/i, '')
    .replace(/^(?:index|readme)$/i, '') || 'introduction'
}

function exactReferenceKey(value: string): string {
  return value.split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\.(?:mdx?|rst|txt)$/i, '')
}

function findOpenApi(files: Array<ScannedFile>): ScannedFile | null {
  return files.find((file) => OPENAPI_FILENAMES.has(basename(file.relativePath).toLowerCase())) ?? null
}

/** An OpenAPI/AsyncAPI spec resolved and ready to copy into `public/`, optionally bound to one tab. */
interface ResolvedApiSpec {
  filename: string
  content: Buffer
  tabLabel?: string
}

const MAX_REMOTE_SPEC_BYTES = 10_000_000
const REMOTE_SPEC_TIMEOUT_SECONDS = 20

/**
 * True when `hostname` is `localhost` or an IP literal in a loopback,
 * link-local, or private range (RFC 1918 / RFC 4193 / IPv6 loopback and
 * link-local). Used to block SSRF against internal infrastructure before
 * `downloadRemoteApiSpec` shells out to `curl`. Only literal IPs and the
 * `localhost` name are checked — this is not a DNS-rebinding defense, it
 * just stops the obvious "docs.json points at 127.0.0.1" case.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  // IPv4 literal
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some((n) => n > 255)) return false
    const [a, b] = octets
    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    if (a === 0) return true // 0.0.0.0/8
    return false
  }
  // IPv6 literal
  if (host.includes(':')) {
    if (host === '::1') return true // loopback
    if (host === '::') return true
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return true // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true // fc00::/7 unique local
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPrivateOrLoopbackHost(mapped[1])
    return false
  }
  return false
}

/**
 * Download a remote OpenAPI spec referenced from docs.json at migration
 * time — Thally's runtime only ever serves a bundled file, never a live
 * URL. https-only, bounded size and time (`curl`'s own limits; the whole
 * migration pipeline is synchronous, so this shells out rather than using
 * an async fetch), and the body must parse as JSON or YAML before it's
 * trusted as a spec. `curl` is also locked to https on every redirect hop
 * and capped at 5 redirects, so a spec host can't 30x the request down to
 * plain http or onto an internal address. Returns null on any failure so
 * the caller warns instead of silently dropping the API reference.
 */
function downloadRemoteApiSpec(url: string): Buffer | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (isPrivateOrLoopbackHost(parsed.hostname)) return null
  const outFile = join(tmpdir(), `thally-migrate-spec-${randomUUID()}`)
  try {
    execFileSync('curl', [
      '-fsSL',
      '--proto', '=https',
      '--proto-redir', '=https',
      '--max-redirs', '5',
      '--max-time', String(REMOTE_SPEC_TIMEOUT_SECONDS),
      '--max-filesize', String(MAX_REMOTE_SPEC_BYTES),
      '-o', outFile,
      '--', parsed.toString(),
    ], { stdio: 'ignore', timeout: (REMOTE_SPEC_TIMEOUT_SECONDS + 10) * 1000 })
    if (!existsSync(outFile) || !lstatSync(outFile).isFile()) return null
    const size = lstatSync(outFile).size
    if (size === 0 || size > MAX_REMOTE_SPEC_BYTES) return null
    const content = readFileSync(outFile)
    const text = content.toString('utf8')
    try {
      JSON.parse(text)
    } catch {
      try {
        parseYaml(text)
      } catch {
        return null
      }
    }
    return content
  } catch {
    return null
  } finally {
    try {
      rmSync(outFile, { force: true })
    } catch {
      // Best-effort cleanup; a leaked temp file never reaches the migrated project.
    }
  }
}

/** A stable, collision-free `public/` filename for a downloaded remote spec. */
function remoteSpecFilename(url: string, index: number, taken: Set<string>): string {
  let base = 'remote-openapi-spec.json'
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).at(-1)
    if (last) base = last.replace(/[^a-zA-Z0-9_.-]/g, '-')
  } catch {
    // Keep the default name.
  }
  if (!/\.(?:ya?ml|json)$/i.test(base)) base += '.json'
  let candidate = base
  let suffix = index
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${suffix}-${base}`
    suffix += 1
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

function mintlifyTopLevelApiReferences(config: Record<string, unknown> | null): Array<MintlifyApiSpecReference> {
  const api = config?.api && typeof config.api === 'object' && !Array.isArray(config.api)
    ? config.api as Record<string, unknown>
    : null
  if (!api) return []
  const references: Array<MintlifyApiSpecReference> = []
  for (const kind of ['openapi', 'asyncapi'] as const) {
    const value = api[kind]
    const values = typeof value === 'string'
      ? [value]
      : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
    for (const entry of values) references.push({ value: entry, kind })
  }
  return references
}

/**
 * Resolve every OpenAPI/AsyncAPI reference in a Mintlify config — the
 * top-level `api.openapi`/`api.asyncapi` plus every per-tab/group/anchor
 * `openapi`/`asyncapi` field in `navigation` — into copyable spec bytes
 * bound to the tab that referenced them. AsyncAPI has no Thally renderer,
 * so it only ever produces a warning naming the spec. A remote `https://`
 * reference is downloaded; anything that can't be resolved (a missing
 * local file, a failed download, a non-https URL) produces a specific
 * warning rather than silently disappearing.
 */
function resolveMintlifyApiSpecs(
  mintlifyConfig: Record<string, unknown> | null,
  files: Array<ScannedFile>,
  warnings: Array<MigrationWarning>,
): Array<ResolvedApiSpec> {
  if (!mintlifyConfig) return []
  const references = [
    ...mintlifyTopLevelApiReferences(mintlifyConfig),
    ...mintlifyNavigationApiReferences(mintlifyConfig),
  ]
  const seen = new Set<string>()
  const taken = new Set(files.map((file) => basename(file.relativePath).toLowerCase()))
  const specs: Array<ResolvedApiSpec> = []
  let remoteIndex = 0
  for (const reference of references) {
    const dedupeKey = `${reference.kind}:${reference.value}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const tabSuffix = reference.tabLabel ? ` (tab "${reference.tabLabel}")` : ''
    if (reference.kind === 'asyncapi') {
      warnings.push({
        code: 'unsupported-config',
        message: `AsyncAPI is not supported by Thally's API reference; the spec "${reference.value}"${tabSuffix} was not migrated.`,
      })
      continue
    }
    if (/^https?:\/\//i.test(reference.value)) {
      if (!/^https:\/\//i.test(reference.value)) {
        warnings.push({
          code: 'unsupported-config',
          message: `The OpenAPI spec URL "${reference.value}"${tabSuffix} is not https and was not downloaded.`,
        })
        continue
      }
      let blockedHost = false
      try {
        blockedHost = isPrivateOrLoopbackHost(new URL(reference.value).hostname)
      } catch {
        blockedHost = false
      }
      if (blockedHost) {
        warnings.push({
          code: 'unsupported-config',
          message: `The OpenAPI spec URL "${reference.value}"${tabSuffix} points at a local or private address and was not downloaded.`,
        })
        continue
      }
      const content = downloadRemoteApiSpec(reference.value)
      if (!content) {
        warnings.push({
          code: 'unsupported-config',
          message: `The remote OpenAPI spec "${reference.value}"${tabSuffix} could not be downloaded and was not migrated. Download it manually and add it to public/.`,
        })
        continue
      }
      remoteIndex += 1
      specs.push({ filename: remoteSpecFilename(reference.value, remoteIndex, taken), content, tabLabel: reference.tabLabel })
      continue
    }
    const key = reference.value.split(/[?#]/, 1)[0].replace(/^\/+/, '').replace(/\\/g, '/')
    const match = files.find((file) => file.relativePath === key)
    if (!match) {
      warnings.push({
        code: 'unsupported-config',
        message: `The OpenAPI spec "${reference.value}"${tabSuffix} could not be found in the repository and was not migrated.`,
      })
      continue
    }
    specs.push({ filename: basename(match.relativePath), content: readFileSync(match.absolutePath), tabLabel: reference.tabLabel })
  }
  return specs
}

const MAX_FERN_GENERATORS_BYTES = 2_000_000

function fernGeneratorsOpenApiPaths(config: Record<string, unknown>): Array<string> {
  const api = config.api
  if (typeof api === 'string') return [api]
  if (!api || typeof api !== 'object' || Array.isArray(api)) return []
  const specs = (api as Record<string, unknown>).specs
  if (!Array.isArray(specs)) return []
  return specs.flatMap((spec) => {
    if (typeof spec === 'string') return [spec]
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return []
    const openapi = (spec as Record<string, unknown>).openapi
    return typeof openapi === 'string' ? [openapi] : []
  })
}

/**
 * Fern's `generators.yml` can also point an `api.specs[]` entry at an
 * AsyncAPI or OpenRPC document instead of OpenAPI. Thally's API reference
 * only renders OpenAPI, so these are named here purely to produce a
 * specific warning (`fernGeneratorsOpenApiPaths` above never returns them,
 * so without this they'd otherwise look like a missing spec).
 */
function fernGeneratorsUnsupportedSpecPaths(config: Record<string, unknown>): Array<{ kind: 'asyncapi' | 'openrpc'; path: string }> {
  const api = config.api
  if (!api || typeof api !== 'object' || Array.isArray(api)) return []
  const specs = (api as Record<string, unknown>).specs
  if (!Array.isArray(specs)) return []
  return specs.flatMap((spec): Array<{ kind: 'asyncapi' | 'openrpc'; path: string }> => {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return []
    const record = spec as Record<string, unknown>
    if (typeof record.asyncapi === 'string') return [{ kind: 'asyncapi', path: record.asyncapi }]
    if (typeof record.openrpc === 'string') return [{ kind: 'openrpc', path: record.openrpc }]
    return []
  })
}

function readFernGeneratorsConfig(path: string): Record<string, unknown> | null {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > MAX_FERN_GENERATORS_BYTES) return null
  const parsed = parseYaml(readFileSync(path, 'utf8'))
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
}

/**
 * Resolve the OpenAPI spec Fern's `generators.yml` configures for an API:
 * modern `api.specs[].openapi`, or the legacy top-level `api:` string.
 * Multi-API repos keep a `generators.yml` per API under `fern/apis/<name>/`;
 * single-API repos keep one at the Fern project root.
 *
 * The root `generators.yml` belongs to a *different* API only in a multi-API
 * repo, which Fern lays out under `fern/apis/`. So the root config is skipped
 * only when an explicit `api-name` is set AND a `fern/apis/` directory
 * exists; a single-API repo whose docs.yml still names its API keeps its tab.
 */
function fernOpenApiCandidateDirs(fernRoot: string, apiName: string | undefined, apiNameExplicit: boolean): Array<string> {
  const candidateDirs: Array<string> = []
  if (apiName) {
    try {
      candidateDirs.push(resolveWithin(fernRoot, `apis/${apiName}`))
    } catch {
      // Not a safe relative path (e.g. a display label, not a folder name).
    }
  }
  const apisDir = resolvePath(fernRoot, 'apis')
  const multiApi = existsSync(apisDir) && lstatSync(apisDir).isDirectory()
  if (!apiNameExplicit || !multiApi) candidateDirs.push(fernRoot)
  return candidateDirs
}

/** `findFernConfiguredOpenApi`'s result, plus any AsyncAPI/OpenRPC specs seen along the way (Thally has no renderer for either). */
interface FernOpenApiResolution {
  spec: ScannedFile | null
  unsupported: Array<{ kind: 'asyncapi' | 'openrpc'; path: string }>
}

function findFernConfiguredOpenApi(
  fernRoot: string,
  repositoryDir: string,
  apiName: string | undefined,
  apiNameExplicit: boolean,
  warnings: Array<MigrationWarning>,
): FernOpenApiResolution {
  const candidateDirs = fernOpenApiCandidateDirs(fernRoot, apiName, apiNameExplicit)
  const unsupported: Array<{ kind: 'asyncapi' | 'openrpc'; path: string }> = []
  for (const dir of candidateDirs) {
    let config: Record<string, unknown> | null = null
    let generatorsPath: string
    try {
      generatorsPath = resolveWithin(dir, 'generators.yml')
      config = readFernGeneratorsConfig(generatorsPath)
    } catch {
      continue
    }
    if (!config) continue
    for (const specPath of fernGeneratorsOpenApiPaths(config)) {
      if (/^(?:https?:)?\/\//i.test(specPath)) continue
      // `openapi:` in generators.yml is conventionally relative to that
      // file's own directory (a multi-API repo's `fern/apis/<name>/`), not
      // to the Fern root, so it commonly points outside `dir` (e.g. Cohere's
      // `../../../cohere-openapi.yaml`). The security boundary is still the
      // whole repository checkout, never anything above it.
      try {
        const absolute = resolveWithinRoot(dir, specPath, repositoryDir)
        if (!existsSync(absolute) || !lstatSync(absolute).isFile()) continue
        return { spec: { absolutePath: absolute, relativePath: relative(repositoryDir, absolute).replace(/\\/g, '/') }, unsupported }
      } catch {
        warnings.push({
          code: 'unsupported-config',
          message: `The OpenAPI spec path "${specPath}" in ${relative(repositoryDir, generatorsPath).replace(/\\/g, '/')} is outside the repository and was skipped.`,
        })
      }
    }
    unsupported.push(...fernGeneratorsUnsupportedSpecPaths(config))
  }
  return { spec: null, unsupported }
}

/** Whether a Fern Definition (as opposed to a plain OpenAPI/AsyncAPI spec) backs this API. */
function fernDefinitionExists(fernRoot: string, apiName: string | undefined): boolean {
  const candidateDirs: Array<string> = []
  if (apiName) {
    try {
      candidateDirs.push(resolveWithin(fernRoot, `apis/${apiName}/definition`))
    } catch {
      // Not a safe relative path; skip.
    }
  }
  try {
    candidateDirs.push(resolveWithin(fernRoot, 'definition'))
  } catch {
    // Unreachable: 'definition' is always a safe relative segment.
  }
  return candidateDirs.some((dir) => existsSync(dir) && lstatSync(dir).isDirectory())
}

function withoutFrontmatter(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

function staticSnippetProperties(attributes: string): Map<string, string> {
  const properties = new Map<string, string>()
  const matcher = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g
  for (const match of attributes.matchAll(matcher)) {
    properties.set(match[1], match[2] ?? match[3] ?? match[4] ?? match[5] ?? '')
  }
  return properties
}

function interpolateSnippet(snippet: string, attributes: string): string {
  const properties = staticSnippetProperties(attributes)
  if (properties.size === 0) return snippet
  let fence = ''
  return snippet.split('\n').map((line) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker) {
      if (!fence) fence = marker[0]
      else if (marker[0] === fence) fence = ''
      return line
    }
    if (fence) return line
    return line.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (original, name: string) => {
      return properties.get(name) ?? original
    })
  }).join('\n')
}

function resolveSnippetPath(
  sourcePath: string,
  currentFile: string,
  repositoryRoot: string,
  siteRoot: string,
): string {
  const repositoryRelative = sourcePath.startsWith('@site/')
    ? relative(repositoryRoot, resolveWithin(siteRoot, sourcePath.slice('@site/'.length))).replace(/\\/g, '/')
    : sourcePath.startsWith('/')
      ? relative(repositoryRoot, resolveWithin(siteRoot, sourcePath.replace(/^\/+/, ''))).replace(/\\/g, '/')
      : relative(repositoryRoot, resolvePath(dirname(currentFile), sourcePath)).replace(/\\/g, '/')
  const candidate = resolveWithin(repositoryRoot, repositoryRelative)
  resolveWithin(repositoryRoot, relative(repositoryRoot, candidate))
  return candidate
}

function globalSnippetAliases(
  files: Array<ScannedFile>,
  repositoryRoot: string,
  siteRoot: string,
): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const file of files) {
    const segments = file.relativePath.split('/')
    if (!segments.some((segment) => SNIPPET_DIRECTORIES.has(segment.toLowerCase()))) continue
    const basenameWithoutExtension = basename(file.relativePath).replace(/\.mdx?$/i, '')
    const conventionalAlias = basenameWithoutExtension
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
    if (conventionalAlias) aliases.set(conventionalAlias, file.absolutePath)
  }
  for (const file of files) {
    if (!['.md', '.mdx'].includes(extname(file.relativePath).toLowerCase())) continue
    const raw = readFileSync(file.absolutePath, 'utf8')
    for (const match of raw.matchAll(SNIPPET_IMPORT_PATTERN)) {
      try {
        const componentName = match[1] ?? match[2]
        const candidate = resolveSnippetPath(match[3], file.absolutePath, repositoryRoot, siteRoot)
        if (existsSync(candidate) && lstatSync(candidate).isFile()) {
          aliases.set(componentName, candidate)
        }
      } catch {
        // The page-local inliner emits the actionable warning when it reaches
        // an unsafe or missing import. Global discovery is best-effort only.
      }
    }
  }
  return aliases
}

function repositoryAssetHref(
  value: string,
  currentFile: string,
  siteRoot: string,
  onReferenced?: (normalizedPath: string) => void,
): string | null {
  const isBracketed = value.startsWith('<') && value.endsWith('>')
  const raw = isBracketed ? value.slice(1, -1) : value
  if (!raw || raw.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return null
  const suffixIndex = raw.search(/[?#]/)
  const pathname = suffixIndex >= 0 ? raw.slice(0, suffixIndex) : raw
  const suffix = suffixIndex >= 0 ? raw.slice(suffixIndex) : ''
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (!ASSET_EXTENSIONS.has(extname(decodedPath).toLowerCase())) return null
  try {
    const candidate = decodedPath.startsWith('/')
      ? resolveWithin(siteRoot, decodedPath.replace(/^\/+/, ''))
      : resolveWithin(dirname(currentFile), decodedPath)
    // Mintlify's deploy root is the directory containing docs.json. Do not
    // copy or expose a relative reference that escapes that project boundary.
    const siteRelative = relative(siteRoot, candidate).replace(/\\/g, '/')
    resolveWithin(siteRoot, siteRelative)
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) return null
    const normalized = normalizeAssetPath(siteRelative)
    if (!normalized) return null
    onReferenced?.(normalized)
    const rewritten = `/${normalized}${suffix}`
    // Markdown destinations containing parentheses must stay angle-bracketed;
    // removing the wrapper makes CommonMark terminate the URL too early.
    return isBracketed ? `<${rewritten}>` : rewritten
  } catch {
    return null
  }
}

/**
 * Rewrite links to a page whose Fern frontmatter `slug` replaced its docs.yml
 * hierarchy. Other pages still spell the link the "natural" nested way, so
 * this runs across every page's body, not just the renamed page's own.
 */
function rewriteFernIdRenameLinks(body: string, renames: Map<string, string>): string {
  let codeFence: string | null = null
  return body.split('\n').map((line) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (!codeFence) codeFence = fence[1][0]
      else if (fence[1][0] === codeFence) codeFence = null
      return line
    }
    if (codeFence) return line
    const rewriteTarget = (target: string): string => {
      const suffixIndex = target.search(/[?#]/)
      const path = (suffixIndex >= 0 ? target.slice(0, suffixIndex) : target).replace(/^\/+/, '')
      const suffix = suffixIndex >= 0 ? target.slice(suffixIndex) : ''
      const renamed = renames.get(path)
      return renamed ? `/${renamed}${suffix}` : target
    }
    return line
      .replace(/(\]\()\/([^\s)]+)(?=[\s)]|$)/g, (_match, prefix: string, target: string) => `${prefix}${rewriteTarget(`/${target}`)}`)
      .replace(/(\bhref=")\/([^"]+)(")/g, (_match, prefix: string, target: string, suffix: string) => `${prefix}${rewriteTarget(`/${target}`)}${suffix}`)
  }).join('\n')
}

function rewriteRepositoryAssetLinks(
  body: string,
  currentFile: string,
  siteRoot: string,
  onReferenced?: (normalizedPath: string) => void,
): string {
  return body
    .replace(/(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)([^)]*\))/g, (
      original,
      opening: string,
      destination: string,
      closing: string,
    ) => {
      const rewritten = repositoryAssetHref(destination, currentFile, siteRoot, onReferenced)
      return rewritten ? `${opening}${rewritten}${closing}` : original
    })
    .replace(/\b(src|img|image|href)=(['"])([^'"]+)\2/g, (
      original,
      property: string,
      quote: string,
      destination: string,
    ) => {
      const rewritten = repositoryAssetHref(destination, currentFile, siteRoot, onReferenced)
      return rewritten ? `${property}=${quote}${rewritten}${quote}` : original
    })
}

const LOCAL_EXPORT_DECLARATION = /^\s*export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/

/**
 * Names a page declares itself with a top-level `export const/function/class`.
 * Mintlify treats every file under `/snippets/` as an implicitly available
 * global component keyed by its filename, so a page that happens to declare
 * an inline component with the same name (e.g. both `snippets/counter.mdx`
 * and a page's own `export const Counter = ...`) must keep its local
 * declaration: forcing the unrelated global snippet's source in over a
 * `<Counter />` usage duplicates the export and breaks the compiled module.
 */
function locallyDeclaredNames(raw: string): Set<string> {
  const names = new Set<string>()
  let codeFence: string | null = null
  for (const line of raw.split('\n')) {
    const codeMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (codeMatch) {
      if (!codeFence) codeFence = codeMatch[1][0]
      else if (codeMatch[1][0] === codeFence) codeFence = null
      continue
    }
    if (codeFence) continue
    const declared = line.match(LOCAL_EXPORT_DECLARATION)?.[1]
    if (declared) names.add(declared)
  }
  return names
}

function inlineMdxSnippets(
  raw: string,
  currentFile: string,
  repositoryRoot: string,
  warnings: Array<MigrationWarning>,
  depth = 0,
  siteRoot = repositoryRoot,
  globalAliases: Map<string, string> = new Map(),
): string {
  if (depth >= 8) return raw
  const snippets = new Map<string, string>()
  const withoutImports = raw.replace(
    SNIPPET_IMPORT_PATTERN,
    (_statement, namedComponent: string | undefined, defaultComponent: string | undefined, sourcePath: string) => {
      const componentName = (namedComponent ?? defaultComponent) as string
      try {
        const candidate = resolveSnippetPath(sourcePath, currentFile, repositoryRoot, siteRoot)
        if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error('file not found')
        const nested = inlineMdxSnippets(
          withoutFrontmatter(readFileSync(candidate, 'utf8')),
          candidate,
          repositoryRoot,
          warnings,
          depth + 1,
          siteRoot,
          globalAliases,
        )
        snippets.set(componentName, nested)
        return ''
      } catch {
        warnings.push({
          code: 'missing-page',
          message: `Imported snippet ${sourcePath} could not be resolved and was left as a comment.`,
          source: relative(repositoryRoot, currentFile).replace(/\\/g, '/'),
        })
        snippets.set(componentName, `{/* Missing imported snippet: ${sourcePath} */}`)
        return ''
      }
    },
  )
  // Mintlify resolves snippet imports across its MDX compilation graph. Some
  // real sites consequently reuse an alias on a page that does not repeat the
  // import declaration. Recover those aliases deterministically from imports
  // elsewhere in the same docs project.
  const localNames = locallyDeclaredNames(withoutImports)
  for (const [componentName, candidate] of globalAliases) {
    if (snippets.has(componentName) || localNames.has(componentName)
      || !new RegExp(`<${componentName}(?:\\s|/?>)`).test(withoutImports)) continue
    const nested = inlineMdxSnippets(
      withoutFrontmatter(readFileSync(candidate, 'utf8')),
      candidate,
      repositoryRoot,
      warnings,
      depth + 1,
      siteRoot,
      globalAliases,
    )
    snippets.set(componentName, nested)
  }
  let result = withoutImports
  for (const [componentName, snippet] of snippets) {
    result = result
      .replace(new RegExp(`<${componentName}((?:\\s[^>]*)?)\\s*/>`, 'g'), (_tag, attributes: string) => {
        return interpolateSnippet(snippet, attributes)
      })
      .replace(new RegExp(`<${componentName}((?:\\s[^>]*)?)>(?:[\\s\\S]*?)<\\/${componentName}>`, 'g'), (_tag, attributes: string) => {
        return interpolateSnippet(snippet, attributes)
      })
  }
  result = result.replace(SNIPPET_TAG_PATTERN, (_tag, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
    const filePath = (doubleQuoted ?? singleQuoted)!
    try {
      const candidate = resolveWithin(siteRoot, `snippets/${filePath}`)
      if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error('file not found')
      return inlineMdxSnippets(
        withoutFrontmatter(readFileSync(candidate, 'utf8')),
        candidate,
        repositoryRoot,
        warnings,
        depth + 1,
        siteRoot,
        globalAliases,
      )
    } catch {
      warnings.push({
        code: 'missing-page',
        message: `Snippet file="${filePath}" could not be resolved and was left as a comment.`,
        source: relative(repositoryRoot, currentFile).replace(/\\/g, '/'),
      })
      return `{/* Missing snippet: ${filePath} */}`
    }
  })
  return result
}

/**
 * Bind one or more resolved specs into their tabs. A spec with no
 * `tabLabel` (the common single-spec case) falls back to an existing
 * "*api*"-labelled tab, or gets a new "API Reference" tab of its own — the
 * original single-spec behavior. A spec with a `tabLabel` only ever binds
 * to that exact tab (creating it if the source tab had no other content
 * and so was dropped from `config.tabs` earlier), never the loose
 * substring fallback, so two specs from two different tabs can never both
 * land on the same tab by accident.
 */
function injectOpenApiSpecs(config: MigrationDocsConfig, specs: Array<{ filename: string; tabLabel?: string }>): MigrationDocsConfig {
  let tabs = config.tabs.map((tab) => ({ ...tab }))
  for (const spec of specs) {
    const apiTab = spec.tabLabel
      ? tabs.find((tab) => tab.tab === spec.tabLabel)
      : tabs.find((tab) => tab.tab.toLowerCase().includes('api'))
    if (apiTab) apiTab.api = { source: `/${spec.filename}`, navigation: false }
    else tabs = [...tabs, { tab: spec.tabLabel ?? 'API Reference', api: { source: `/${spec.filename}` } }]
  }
  return { ...config, tabs }
}

/** Identify component ownership independently of checkout paths and URL syntax. */
function componentSourceIdentity(sourceUrl: string, repositoryDir: string, siteRoot: string): string {
  const url = new URL(sourceUrl)
  // A GitHub tree URL and the repository root identify the same source. Branch
  // changes should update its components, while separate monorepo sites must
  // retain independent namespaces even if their snippet filenames coincide.
  // Credentials, queries and fragments are not source identity and never feed
  // generated names; only the canonical origin/path and docs root participate.
  const repository = url.hostname.toLowerCase() === 'github.com'
    ? `https://github.com/${url.pathname.split('/').filter(Boolean).slice(0, 2).join('/').replace(/\.git$/i, '').toLowerCase()}`
    : `${url.origin}${trimTrailingSlashes(url.pathname)}`
  return JSON.stringify([repository, relative(repositoryDir, siteRoot).replace(/\\/g, '/')])
}

/** Import an already-available repository directory into a canonical bundle. */
export function migrateRepository(options: RepositoryMigrationOptions): MigrationBundle {
  const repositoryDir = options.repositoryDir
  const platform = options.platform ?? detectRepositoryPlatform(repositoryDir, options.docsDir)
  const warnings: Array<MigrationWarning> = []
  const mintlifyProjectRoot = platform === 'mintlify'
    ? findMintlifyProjectRoot(repositoryDir, options.docsDir, warnings)
    : null
  const docusaurusProjectRoot = platform === 'docusaurus'
    ? findDocusaurusProjectRoot(repositoryDir, options.docsDir, warnings)
    : null
  const fernProjectRoot = platform === 'fern'
    ? findFernProjectRoot(repositoryDir, options.docsDir)
    : null
  const configuredDocsDir = (() => {
    if (options.docsDir !== undefined) {
      const selected = resolveWithin(repositoryDir, options.docsDir || '.')
      if (platform === 'docusaurus' && hasDocusaurusConfig(selected)) {
        const projectRelative = relative(repositoryDir, selected).replace(/\\/g, '/')
        return [projectRelative, primaryDocusaurusDocsDirectory(selected)].filter(Boolean).join('/')
      }
      return options.docsDir
    }
    if (docusaurusProjectRoot) {
      const projectRelative = relative(repositoryDir, docusaurusProjectRoot).replace(/\\/g, '/')
      return [projectRelative, primaryDocusaurusDocsDirectory(docusaurusProjectRoot)].filter(Boolean).join('/')
    }
    if (platform === 'mintlify' && mintlifyProjectRoot) {
      return relative(repositoryDir, mintlifyProjectRoot).replace(/\\/g, '/')
    }
    if (platform === 'fern' && fernProjectRoot) {
      return relative(repositoryDir, fernProjectRoot).replace(/\\/g, '/')
    }
    return platform === 'mintlify' ? '' : detectRepositoryDocsDir(repositoryDir)
  })()
  // Only the current, default-locale docs are imported (`configuredDocsDir`,
  // below, never points inside these). Thally has no versions concept and
  // Docusaurus' own i18n content lives in a separate tree this adapter does
  // not project, so both are reported rather than silently dropped.
  if (platform === 'docusaurus' && docusaurusProjectRoot) {
    for (const [directory, label] of [
      ['versioned_docs', 'versioned docs'],
      ['versioned_sidebars', 'versioned sidebars'],
    ] as const) {
      const path = resolveWithin(docusaurusProjectRoot, directory)
      if (!existsSync(path) || !lstatSync(path).isDirectory()) continue
      const versions = readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      if (versions.length) warnings.push({
        code: 'unsupported-config',
        message: `Docusaurus ${label} were skipped; only current docs were imported. Skipped: ${versions.join(', ')}.`,
        source: directory,
      })
    }
    const i18nPath = resolveWithin(docusaurusProjectRoot, 'i18n')
    if (existsSync(i18nPath) && lstatSync(i18nPath).isDirectory()) {
      const locales = readdirSync(i18nPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      if (locales.length) warnings.push({
        code: 'unsupported-config',
        message: `Docusaurus localized content was skipped; only the default locale was imported. Skipped locales: ${locales.join(', ')}.`,
        source: 'i18n',
      })
    }
  }
  // A Docusaurus or Fern MDX page can import its own local components
  // (relative, or `@site/...` for Docusaurus) and bare npm packages the same
  // way a Mintlify page can; the same bounded component graph and
  // import-stripping logic applies to any source, rooted at whichever
  // project actually owns the pages. `@site/...` is Docusaurus' own alias
  // for its project root specifically (not the whole repository) and must
  // keep resolving there. A plain relative import (`../../components/X`),
  // though, is written relative to the *page*, which can live outside that
  // root in a monorepo where docs/ is a sibling of website/ (e.g. Redux) or
  // of a Fern project directory rather than nested under it — the
  // repository, not the narrower platform root, is the real confinement
  // boundary for those.
  const componentRoot = mintlifyProjectRoot ?? docusaurusProjectRoot ?? fernProjectRoot ?? repositoryDir
  const componentMigrator = platform === 'mintlify' || platform === 'docusaurus' || platform === 'fern'
    ? createComponentMigrator(componentRoot, repositoryDir, warnings, componentSourceIdentity(options.sourceUrl, repositoryDir, componentRoot))
    : undefined
  let docsConfig: MigrationDocsConfig = { tabs: [] }
  const referenceMap = new Map<string, { navigationId: string; locale?: string }>()
  const exactReferenceMap = new Map<string, { navigationId: string; locale?: string }>()
  const referenceOrder = new Map<string, number>()
  let docusaurusSidebars: DocusaurusSidebars | null = null
  let mintlifyConfig: Record<string, unknown> | null = null
  let fernRawConfig: Record<string, unknown> | null = null
  let fernApiSections: Array<FernApiSection> = []

  if (platform === 'mintlify') {
    try {
      const config = readMintlifyConfig(mintlifyProjectRoot ?? repositoryDir)
      if (config) {
        mintlifyConfig = config
        const projected = projectMintlifyNavigation(config)
        docsConfig = projected.docsConfig
        warnings.push(...projected.warnings)
        for (const [index, reference] of projected.pageReferences.entries()) {
          const key = normalizedReferenceKey(reference.ref)
          // Shared source pages may appear in several language menus. The
          // projector visits the default language first; retain that primary
          // file so other locales can use the runtime's content fallback.
          if (!referenceMap.has(key)) referenceMap.set(key, reference)
          const exactKey = exactReferenceKey(reference.ref)
          if (!exactReferenceMap.has(exactKey)) exactReferenceMap.set(exactKey, reference)
          if (!referenceOrder.has(key)) referenceOrder.set(key, index)
        }
      }
    } catch (error) {
      warnings.push({
        code: 'unsupported-config',
        message: `Mintlify config could not be read: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  if (platform === 'fern' && fernProjectRoot) {
    try {
      const fernConfig = readFernConfig(fernProjectRoot)
      if (fernConfig) {
        fernRawConfig = fernConfig.config
        const projected = projectFernNavigation({ config: fernConfig.config, fernRoot: fernProjectRoot })
        docsConfig = projected.docsConfig
        warnings.push(...projected.warnings)
        fernApiSections = projected.apiSections
        for (const [index, descriptor] of projected.descriptors.entries()) {
          const key = normalizedReferenceKey(descriptor.sourcePath)
          if (!referenceMap.has(key)) referenceMap.set(key, { navigationId: descriptor.navigationId })
          const exactKey = exactReferenceKey(descriptor.sourcePath)
          if (!exactReferenceMap.has(exactKey)) exactReferenceMap.set(exactKey, { navigationId: descriptor.navigationId })
          if (!referenceOrder.has(key)) referenceOrder.set(key, index)
        }
      }
    } catch (error) {
      warnings.push({
        code: 'unsupported-config',
        message: `Fern config could not be read: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  if (platform === 'docusaurus') {
    try {
      docusaurusSidebars = options.docusaurusSkipSidebar || !docusaurusProjectRoot
        ? null
        : readDocusaurusSidebars(docusaurusProjectRoot)
    } catch (error) {
      warnings.push({
        code: 'unsupported-config',
        message: `Docusaurus sidebar could not be read safely: ${error instanceof Error ? error.message : String(error)} Generated navigation will be used.`,
      })
    }
  }

  const contentRoot = resolveWithin(repositoryDir, configuredDocsDir)
  if (!existsSync(contentRoot) || !lstatSync(contentRoot).isDirectory()) {
    throw new Error(`Documentation directory does not exist: ${configuredDocsDir || '.'}`)
  }
  const mintignoreMatcher = platform === 'mintlify' && mintlifyProjectRoot
    ? readMintignoreMatcher(mintlifyProjectRoot)
    : null
  const files = mintignoreMatcher
    ? scanFiles(contentRoot, repositoryDir).filter((file) => !mintignoreMatcher.ignores(file.relativePath))
    : scanFiles(contentRoot, repositoryDir)
  const pages: Array<MigrationPage> = []
  const assets: Array<MigrationAsset> = []
  // Which pages reference which asset (by its normalized copy-destination
  // path), so the final asset-copy pass can prioritize referenced assets
  // over unreferenced ones when the budget is tight, and name the
  // referencing pages in the warning if one still gets dropped.
  const referencedAssetPaths = new Map<string, Set<string>>()
  const addAssetReference = (assetPath: string, referencingPage: string): void => {
    const referrers = referencedAssetPaths.get(assetPath)
    if (referrers) referrers.add(referencingPage)
    else referencedAssetPaths.set(assetPath, new Set([referencingPage]))
  }
  const docusaurusDescriptors: Array<DocusaurusPageDescriptor> = []
  const seenPageIds = new Set<string>()
  /** docs.yml-derived navigationId -> final id, when a page's frontmatter `slug` overrides it. */
  const fernIdRenames = new Map<string, string>()
  let skipped = 0
  let discovered = files.length

  const localeConfig = docsConfig.i18n
  const defaultPageIds = new Set([...referenceMap.values()]
    .filter((reference) => !reference.locale || reference.locale === localeConfig?.defaultLocale)
    .map((reference) => reference.navigationId))
  const routeAliases: NonNullable<MigrationDocsConfig['redirects']> = []
  const pageFiles = [...files].sort((left, right) => {
    const leftOrder = referenceOrder.get(normalizedReferenceKey(left.relativePath)) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = referenceOrder.get(normalizedReferenceKey(right.relativePath)) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.relativePath.localeCompare(right.relativePath)
  })
  const snippetAliases = platform === 'mintlify' && mintlifyProjectRoot
    ? globalSnippetAliases(files, repositoryDir, mintlifyProjectRoot)
    : new Map<string, string>()
  for (const file of pageFiles) {
    if (!isDocumentationExtension(file.relativePath)) continue
    // Unlike Mintlify/Docusaurus, Fern only ever serves pages reachable from
    // docs.yml (or a versions file); everything else is invisible on the
    // live site, so importing it as an "orphan" page would fabricate content
    // (and can crash a build on stray files that were never meant to render).
    if (platform === 'fern'
      && !exactReferenceMap.has(exactReferenceKey(file.relativePath))
      && !referenceMap.has(normalizedReferenceKey(file.relativePath))) {
      skipped++
      continue
    }
    const sourceSegments = file.relativePath.split('/')
    if (sourceSegments.some((segment) => SNIPPET_DIRECTORIES.has(segment.toLowerCase()))
      || (platform === 'docusaurus' && basename(file.relativePath).startsWith('_'))) {
      skipped++
      continue
    }
    const rootFilename = !file.relativePath.includes('/') ? basename(file.relativePath).toLowerCase() : ''
    if (REPOSITORY_ONLY_DOCUMENTS.has(rootFilename) && !exactReferenceMap.has(exactReferenceKey(file.relativePath))) {
      skipped++
      continue
    }
    if (!['.md', '.mdx'].includes(extname(file.relativePath).toLowerCase())) {
      skipped++
      warnings.push({ code: 'skipped-file', message: 'Only Markdown and MDX are imported without an explicit converter.', source: file.relativePath })
      continue
    }
    const size = lstatSync(file.absolutePath).size
    if (size > MAX_PAGE_BYTES) {
      skipped++
      warnings.push({ code: 'skipped-file', message: 'Page exceeded the 2 MB repository import limit.', source: file.relativePath })
      continue
    }
    const key = normalizedReferenceKey(file.relativePath)
    const referenced = exactReferenceMap.get(exactReferenceKey(file.relativePath)) ?? referenceMap.get(key)
    let locale = referenced?.locale
    let navigationId = referenced?.navigationId ?? pageIdFromReference(file.relativePath, platform === 'mintlify')
    if (!referenced && localeConfig) {
      for (const entry of localeConfig.locales) {
        const localized = mintlifyLocalizedReference(file.relativePath, entry.code, defaultPageIds)
        if (localized === file.relativePath) continue
        locale = entry.code
        navigationId = pageIdFromReference(localized, platform === 'mintlify')
        break
      }
    }
    if (!navigationId) {
      skipped++
      warnings.push({ code: 'invalid-page', message: 'Page path could not be normalized safely.', source: file.relativePath })
      continue
    }
    const isDefaultLocale = !locale || locale === localeConfig?.defaultLocale
    const id = isDefaultLocale ? navigationId : `${locale}/${navigationId}`
    let raw = inlineMdxSnippets(
      readFileSync(file.absolutePath, 'utf8'),
      file.absolutePath,
      repositoryDir,
      warnings,
      0,
      mintlifyProjectRoot ?? docusaurusProjectRoot ?? fernProjectRoot ?? repositoryDir,
      snippetAliases,
    )
    if (componentMigrator) {
      const warningsBeforeTransform = warnings.length
      raw = componentMigrator.transform(raw, file.absolutePath)
      // `transform` excludes a page itself (pushing a 'skipped-file' warning
      // for it) when it references an unsupported npm import outside JSX —
      // keeping that import would fail `next build` for the whole site. Skip
      // building this page too; `pruneMissingNavigationPages` below drops it
      // from navigation since it never joins `pages`.
      // `warning.source` is relative to `componentRoot`, which can differ
      // from `repositoryDir` (a nested Mintlify/Docusaurus project root);
      // compare absolute paths rather than the two relative forms directly.
      if (warnings.slice(warningsBeforeTransform).some((warning) => warning.code === 'skipped-file' && warning.source !== undefined
        && resolvePath(componentRoot, warning.source) === file.absolutePath)) {
        skipped++
        continue
      }
    }
    // A bare `{word}` in prose (e.g. Infisical's STYLE_GUIDE.md `{x}`) is
    // literal text on Mintlify and Docusaurus too, not just Fern — MDX
    // always evaluates `{...}` as a JS expression, so any platform's source
    // can hit the same `ReferenceError` at render. `escapeFernLiteralBraces`
    // is platform-agnostic (it only reads the page's own AST/ESM scope), so
    // run it for every platform Thally migrates from.
    if (platform === 'fern' || platform === 'mintlify' || platform === 'docusaurus') {
      // Math must be protected before the AST-based brace escaper runs:
      // raw `$$\begin{align*}...\end{align*}$$` crashes that parser outright
      // (see `protectMathBlocks`), which is what excluded these pages
      // before this ran.
      const protectedMath = protectMathBlocks(raw)
      if (protectedMath.converted) {
        warnings.push({
          code: 'unsupported-config',
          message: "Math (KaTeX '$$...$$') has no renderer in Thally yet; it was kept as a fenced code block instead of being dropped.",
          source: relative(repositoryDir, file.absolutePath).replace(/\\/g, '/'),
        })
      } else if (protectedMath.guardTriggered) {
        warnings.push({
          code: 'unsupported-config',
          message: 'A suspected math span looked like it needed converting, but doing so broke the page; the page was kept as originally authored instead.',
          source: relative(repositoryDir, file.absolutePath).replace(/\\/g, '/'),
        })
      }
      raw = escapeFernLiteralBraces(protectedMath.body)
    }
    let docusaurusDescriptor: Omit<DocusaurusPageDescriptor, 'title'> | undefined
    const page = parseMarkdownPage({
      id,
      navigationId,
      ...(locale ? { locale } : {}),
      raw,
      platform,
      source: `${options.sourceUrl}#${relative(repositoryDir, file.absolutePath).replace(/\\/g, '/')}`,
      ...(platform === 'docusaurus' ? {
        resolveIdentity: (frontmatter, fallback) => {
          const resolved = resolveDocusaurusPageIdentity(file.relativePath, frontmatter, fallback)
          const routePrefix = options.docusaurusRoutePrefix === undefined
            ? undefined
            : trimEdgeSlashes(options.docusaurusRoutePrefix)
          if (!routePrefix) {
            docusaurusDescriptor = resolved.descriptor
            return resolved.identity
          }
          const prefixedNavigationId = resolved.identity.navigationId === 'introduction'
            ? routePrefix
            : `${routePrefix}/${resolved.identity.navigationId}`
          const prefixedStorageId = resolved.identity.id === 'introduction'
            ? routePrefix
            : `${routePrefix}/${resolved.identity.id}`
          docusaurusDescriptor = {
            ...resolved.descriptor,
            navigationId: prefixedNavigationId,
          }
          return {
            ...resolved.identity,
            id: prefixedStorageId,
            navigationId: prefixedNavigationId,
          }
        },
      } : {}),
      // A Fern page's own frontmatter `slug` replaces its whole section/folder
      // hierarchy (never just its own segment) and wins over a docs.yml slug.
      ...(platform === 'fern' ? {
        resolveIdentity: (frontmatter, fallback) => {
          const slug = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim() : ''
          if (!slug) return fallback
          const overridden = pageIdFromReference(slug, true)
          if (!overridden) return fallback
          fernIdRenames.set(fallback.navigationId, overridden)
          return { ...fallback, id: overridden, navigationId: overridden }
        },
      } : {}),
    })
    if (!page) {
      skipped++
      continue
    }
    if (platform === 'mintlify' && mintlifyProjectRoot) {
      page.body = rewriteRepositoryAssetLinks(page.body, file.absolutePath, mintlifyProjectRoot, (assetPath) => {
        addAssetReference(assetPath, file.relativePath)
      })
    }
    if (platform === 'fern' && fernProjectRoot) {
      page.body = rewriteRepositoryAssetLinks(page.body, file.absolutePath, fernProjectRoot, (assetPath) => {
        addAssetReference(assetPath, file.relativePath)
      })
    }
    if (platform === 'mintlify' || platform === 'docusaurus' || platform === 'fern') {
      // `<Link href="...">` (common Mintlify/Docusaurus prose, e.g. mem0's
      // docs) has no Thally builtin; map it to a plain anchor before the
      // generic unknown-component fallback runs, so a real navigable link
      // survives instead of becoming a `<div>`. Runs on the fully normalized
      // body (after `parseMarkdownPage`'s `normalizeMdx`), so a tag that a
      // platform-specific rename still resolves (Docusaurus `TabItem` ->
      // `Tab`, Mintlify `Warn` -> `Warning`, ...) is never mistaken for
      // unknown. Fern-native components with no Thally equivalent
      // (`Markdown`, `Button`, `Download`, ...) fall into the same generic
      // path below — there is no separate Fern-specific detector, so each
      // unknown tag gets exactly one warning.
      page.body = replaceLinkWithAnchor(page.body)
      // Anything still capitalized and unresolved at this point (not a
      // Thally builtin, not declared/imported by the page, not already
      // handled by componentMigrator's copy/removal above) would otherwise
      // throw "Expected component X to be defined" at render. Warn once per
      // component name and neutralize it: keep a paired tag's children,
      // drop a self-closing one outright.
      page.body = replaceUnknownComponents(page.body, (name) => {
        warnings.push({
          code: 'unsupported-config',
          message: `Component <${name}> has no equivalent in Thally and wasn't found on this page; it was replaced with a plain <div> (or removed, if self-closing) so the page still builds. Add a matching component or edit the page.`,
          source: file.relativePath,
        })
      })
    }
    const mdxError = invalidMdxReason(page.body)
    if (mdxError) {
      skipped++
      warnings.push({
        code: 'skipped-file',
        message: `Page was excluded because it does not compile as MDX: ${mdxError}`,
        source: file.relativePath,
      })
      continue
    }
    // `hasAnyFunctionValuedProp` only proves a function value (a reference to
    // a page-declared function, or a function written inline) is passed as
    // *some* JSX prop; it does not know which tag receives it. A prop
    // landing on a component this migration actually extracted as
    // 'use client' (`Migrated<hash>`/`Inline<n>`) or on a Thally runtime
    // built-in already backed by a 'use client' module (`Accordion`, `Panel`,
    // `Tabs`, ... — see `CLIENT_BUILTIN_COMPONENT_TAGS` in components.ts) is
    // confirmed to cross the server/client boundary and throw at render — a
    // prop on any other tag (an unregistered/removed component) is not
    // confirmed either way, so exclusion (a last resort) is reserved for the
    // confirmed case; the unconfirmed case is warned instead, so it is never
    // silently dropped or silently shipped broken.
    const declaredNames = functionDeclaredNames(page.body)
    if (hasAnyFunctionValuedProp(page.body, declaredNames)) {
      if (propsTargetExtractedClientComponent(page.body, declaredNames)) {
        skipped++
        warnings.push({
          code: 'skipped-file',
          message: "This page passes a function to an interactive component, which can't be rendered on the server. "
            + 'Move the function into the component or edit the page manually.',
          source: file.relativePath,
        })
        continue
      }
      warnings.push({
        code: 'unsupported-config',
        message: "This page might pass a function to an interactive component, which can't be rendered on the "
          + 'server; review it manually if the built page fails to render.',
        source: file.relativePath,
      })
    }
    if (declarationsReferenceBrowserGlobal(page.body)) {
      warnings.push({
        code: 'unsupported-config',
        message: "This page defines a component that uses `document`/`window`, which isn't available when pages "
          + 'are rendered on the server. Move that code into a client component or edit the page manually.',
        source: file.relativePath,
      })
    }
    if (seenPageIds.has(page.id)) {
      skipped++
      warnings.push({ code: 'collision', message: `Multiple source files map to ${page.id}; the first file was kept.`, source: file.relativePath })
      continue
    }
    seenPageIds.add(page.id)
    pages.push(page)
    if (platform === 'mintlify') {
      const sourcePath = exactReferenceKey(file.relativePath)
      // Only literal portable paths become Next redirects: source filenames
      // must never introduce route patterns such as `:param` or wildcards.
      if (sourcePath !== page.id && /^[A-Za-z0-9_./-]+$/.test(sourcePath)) {
        routeAliases.push({ source: `/${sourcePath}`, destination: `/${page.id}`, permanent: false })
      }
    }
    if (docusaurusDescriptor) {
      docusaurusDescriptors.push({ ...docusaurusDescriptor, title: page.title })
    }
  }

  const discoveredReferenceKeys = new Set(files.map((file) => normalizedReferenceKey(file.relativePath)))
  for (const [key] of referenceMap) {
    if (!discoveredReferenceKeys.has(key)) {
      warnings.push({ code: 'missing-page', message: 'A navigation entry did not resolve to a source page.', source: key })
    }
  }

  const docusaurusAssetRoot = docusaurusProjectRoot ?? repositoryDir
  const repositoryAssets = platform === 'docusaurus' && configuredDocsDir && !options.docusaurusSkipAssets
    ? ['static', 'public'].flatMap((directory) => {
        const root = resolveWithin(docusaurusAssetRoot, directory)
        if (!existsSync(root) || !lstatSync(root).isDirectory()) return []
        return scanFiles(root, repositoryDir).map((file) => ({
          ...file,
          relativePath: `${directory}/${file.relativePath}`,
        }))
      })
    : []
  interface AssetCandidate { file: ScannedFile; assetPath: string; size: number }
  const assetCandidates: Array<AssetCandidate> = []
  for (const file of [...files, ...repositoryAssets]) {
    const firstSegment = file.relativePath.split('/', 1)[0].toLowerCase()
    if (!ASSET_EXTENSIONS.has(extname(file.relativePath).toLowerCase())) continue
    if (platform !== 'mintlify' && !ASSET_DIRECTORIES.has(firstSegment)) continue
    const isDocusaurusStatic = platform === 'docusaurus' && firstSegment === 'static'
    const assetPath = normalizeAssetPath(firstSegment === 'public'
      ? file.relativePath.slice('public/'.length)
      : isDocusaurusStatic
        ? file.relativePath.slice('static/'.length)
        : file.relativePath)
    if (!assetPath) continue
    assetCandidates.push({ file, assetPath, size: lstatSync(file.absolutePath).size })
  }
  // Copy assets that pages actually reference before unreferenced ones, so a
  // tight budget drops decorative/unused files first instead of screenshots
  // a page links to (each group keeps its original scan order).
  const isReferenced = (candidate: AssetCandidate): boolean => referencedAssetPaths.has(candidate.assetPath)
  const orderedAssetCandidates = [
    ...assetCandidates.filter((candidate) => isReferenced(candidate)),
    ...assetCandidates.filter((candidate) => !isReferenced(candidate)),
  ]
  let totalAssetBytes = 0
  for (const { file, assetPath, size } of orderedAssetCandidates) {
    if (size > MAX_ASSET_BYTES || totalAssetBytes + size > MAX_TOTAL_ASSET_BYTES) {
      const referencingPages = referencedAssetPaths.get(assetPath)
      warnings.push({
        code: 'limit-reached',
        message: referencingPages
          ? `Asset was skipped because the migration asset budget was exhausted, but it is referenced by: ${[...referencingPages].join(', ')}.`
          : 'An asset was skipped because the migration asset budget was exhausted.',
        source: file.relativePath,
      })
      continue
    }
    const content = readFileSync(file.absolutePath)
    if (isGitLfsPointer(content)) {
      warnings.push({
        code: 'unsupported-config',
        message: 'This asset is a Git LFS pointer, not its real content (Git LFS was skipped during clone because the host has no git-lfs binary). Install git-lfs and re-run the migration, or add the real file to public/ manually.',
        source: file.relativePath,
      })
      continue
    }
    assets.push({ path: assetPath, content })
    totalAssetBytes += size
  }

  if (files.length >= MAX_SOURCE_FILES) {
    warnings.push({ code: 'limit-reached', message: `Repository discovery stopped at ${MAX_SOURCE_FILES} files.` })
  }
  if (platform === 'docusaurus') {
    const projected = projectDocusaurusNavigation({
      sidebars: docusaurusSidebars,
      descriptors: docusaurusDescriptors,
      contentRoot,
      sourceUrl: options.sourceUrl,
      routePrefix: options.docusaurusRoutePrefix,
    })
    docsConfig = projected.docsConfig
    warnings.push(...projected.warnings)
    for (const page of projected.generatedPages) {
      if (seenPageIds.has(page.id)) continue
      seenPageIds.add(page.id)
      pages.push(page)
    }
    const descriptorByNavigationId = new Map(
      docusaurusDescriptors.map((descriptor) => [descriptor.navigationId, descriptor]),
    )
    for (const page of pages) {
      const descriptor = descriptorByNavigationId.get(page.navigationId)
      if (descriptor) page.body = rewriteDocusaurusLinks(page.body, descriptor, docusaurusDescriptors)
    }
    if (docusaurusProjectRoot && !options.docusaurusSkipRedirects) {
      const redirects = readDocusaurusRedirects(docusaurusProjectRoot, warnings)
      if (redirects.length > 0) docsConfig = { ...docsConfig, redirects: [...(docsConfig.redirects ?? []), ...redirects] }
    }
  }
  if (platform === 'fern' && fernIdRenames.size > 0) {
    const renamedRoute = (route: string): string => {
      const renamed = fernIdRenames.get(route.replace(/^\//, ''))
      return renamed ? `/${renamed}` : route
    }
    const renamePages = (nodes: Array<string | MigrationNavigationGroup>): Array<string | MigrationNavigationGroup> =>
      nodes.map((node) => typeof node === 'string'
        ? fernIdRenames.get(node) ?? node
        : { ...node, pages: renamePages(node.pages) })
    for (const page of pages) {
      page.body = rewriteFernIdRenameLinks(page.body, fernIdRenames)
    }
    docsConfig = {
      ...docsConfig,
      tabs: docsConfig.tabs.map((tab) => ({
        ...tab,
        ...(tab.pages ? { pages: renamePages(tab.pages) } : {}),
        ...(tab.groups ? { groups: renamePages(tab.groups) as Array<MigrationNavigationGroup> } : {}),
      })),
      ...(docsConfig.redirects ? {
        redirects: docsConfig.redirects.map((redirect) => ({
          ...redirect,
          source: renamedRoute(redirect.source),
          destination: renamedRoute(redirect.destination),
        })),
      } : {}),
    }
  }
  if (docsConfig.tabs.length === 0) docsConfig = buildNavigationFromPages(pages)
  if (platform === 'fern' && fernProjectRoot) {
    // A repo-wide scan for *any* `openapi.yml`/`.json` file cannot tell one
    // API's spec from another's, so once an explicit `api-name` names a
    // specific API, that naive scan is never consulted as a fallback (the
    // root `generators.yml` rule is in `fernOpenApiCandidateDirs`). A docs.yml
    // with no `api:` node at all falls back to the naive scan, bound to
    // whatever tab `injectOpenApiSpecs` picks for an unbound spec.
    const sections: Array<{ name?: string; nameExplicit: boolean; tabLabel?: string }> = fernApiSections.length > 0
      ? fernApiSections
      : [{ nameExplicit: false }]
    const resolvedSpecs: Array<{ filename: string; tabLabel?: string }> = []
    // Two different multi-API specs commonly share a basename (Paradex's
    // prod_rest and testnet_rest both resolve to their own
    // apis/<name>/openapi/openapi.json) — track which absolute file a
    // filename already names so a second, genuinely different spec gets a
    // distinguishing prefix instead of silently reusing the first spec's
    // copied asset for both tabs.
    const specFilenameSources = new Map<string, string>()
    for (const section of sections) {
      const resolution = findFernConfiguredOpenApi(fernProjectRoot, repositoryDir, section.name, section.nameExplicit, warnings)
      const spec = resolution.spec ?? (!section.nameExplicit ? findOpenApi(files) : null)
      if (spec) {
        let filename = basename(spec.relativePath)
        const existingSource = specFilenameSources.get(filename)
        if (existingSource && existingSource !== spec.absolutePath) {
          const prefix = section.name ? `${section.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-` : `${specFilenameSources.size + 1}-`
          filename = `${prefix}${filename}`
        }
        specFilenameSources.set(filename, spec.absolutePath)
        if (!assets.some((asset) => asset.path === filename)) {
          assets.push({ path: filename, content: readFileSync(spec.absolutePath) })
        }
        resolvedSpecs.push({ filename, tabLabel: section.tabLabel })
        continue
      }
      if (resolution.unsupported.length > 0) {
        const sectionLabel = section.name ? ` for the "${section.name}" API` : ''
        for (const entry of resolution.unsupported) {
          warnings.push({
            code: 'unsupported-config',
            message: `${entry.kind === 'asyncapi' ? 'AsyncAPI' : 'OpenRPC'} is not supported by Thally's API reference; the spec "${entry.path}"${sectionLabel} was not migrated.`,
          })
        }
        continue
      }
      if (section.name === undefined) continue
      if (fernDefinitionExists(fernProjectRoot, section.name)) {
        warnings.push({
          code: 'unsupported-config',
          message: `This API${section.name ? ` ("${section.name}")` : ''} is defined with a Fern Definition, not an OpenAPI/AsyncAPI document; generating a spec from a Fern Definition is not supported. Export an OpenAPI document and reference it from generators.yml, or add it manually.`,
        })
        continue
      }
      // Neither an OpenAPI/AsyncAPI spec nor a Fern Definition could be found
      // for this `api:` node — the API tab was silently dropped from the nav.
      // Name the node so the user knows which one to fix.
      const checked = fernOpenApiCandidateDirs(fernProjectRoot, section.name, section.nameExplicit)
        .map((dir) => relative(repositoryDir, resolvePath(dir, 'generators.yml')).replace(/\\/g, '/'))
      if (!section.nameExplicit) checked.push('any openapi or swagger file in the repository')
      warnings.push({
        code: 'unsupported-config',
        message: checked.length
          ? `No OpenAPI/AsyncAPI spec could be found for the "${section.name}" API. Checked: ${checked.join(', ')}. Point generators.yml at a spec file that exists.`
          : `No OpenAPI/AsyncAPI spec could be found for the "${section.name}" API, because its api-name is not a valid folder name. Add the spec manually.`,
      })
    }
    if (resolvedSpecs.length > 0) docsConfig = injectOpenApiSpecs(docsConfig, resolvedSpecs)
  } else if (platform === 'mintlify') {
    const resolvedSpecs = resolveMintlifyApiSpecs(mintlifyConfig, files, warnings)
    for (const spec of resolvedSpecs) {
      if (!assets.some((asset) => asset.path === spec.filename)) {
        assets.push({ path: spec.filename, content: spec.content })
      }
    }
    if (resolvedSpecs.length > 0) {
      docsConfig = injectOpenApiSpecs(docsConfig, resolvedSpecs)
    } else {
      // No docs.json-configured spec at all: fall back to a naive repo scan,
      // matching every other platform's baseline behavior.
      const fallback = findOpenApi(files)
      if (fallback) {
        const filename = basename(fallback.relativePath)
        if (!assets.some((asset) => asset.path === filename)) {
          assets.push({ path: filename, content: readFileSync(fallback.absolutePath) })
        }
        docsConfig = injectOpenApiSpecs(docsConfig, [{ filename }])
      }
    }
  }
  if (platform === 'mintlify') {
    const sources = new Set((docsConfig.redirects ?? []).map((redirect) => redirect.source))
    const aliases = routeAliases.filter((redirect) => !sources.has(redirect.source))
    if (aliases.length > 0) docsConfig = { ...docsConfig, redirects: [...(docsConfig.redirects ?? []), ...aliases] }
    docsConfig = addMintlifyHomepageRedirects(addMintlifyDirectoryRedirects(docsConfig, pages), pages)
  }

  if (platform === 'docusaurus' && docusaurusProjectRoot && !options.docusaurusSkipPlugins) {
    for (const plugin of additionalDocusaurusPluginRoots(repositoryDir, docusaurusProjectRoot, warnings)) {
      if (plugin.docsDir === configuredDocsDir) continue
      const pluginBundle = migrateRepository({
        ...options,
        docsDir: plugin.docsDir,
        platform: 'docusaurus',
        docusaurusRoutePrefix: plugin.routePrefix,
        docusaurusSkipPlugins: true,
        docusaurusSkipSidebar: true,
        docusaurusSkipAssets: true,
        docusaurusSkipRedirects: true,
      })
      for (const page of pluginBundle.pages) {
        if (seenPageIds.has(page.id)) continue
        seenPageIds.add(page.id)
        pages.push(page)
      }
      const assetPaths = new Set(assets.map((asset) => asset.path))
      for (const asset of pluginBundle.assets) {
        if (assetPaths.has(asset.path)) continue
        assetPaths.add(asset.path)
        assets.push(asset)
      }
      const pluginLabel = plugin.routePrefix
        .split(/[-_/]/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
      docsConfig.tabs.push(...pluginBundle.docsConfig.tabs.map((tab, index) => ({
        ...tab,
        tab: index === 0 ? pluginLabel : `${pluginLabel}: ${tab.tab}`,
      })))
      warnings.push(...pluginBundle.warnings)
      discovered += pluginBundle.stats.discovered
      skipped += pluginBundle.stats.skipped
    }
  }

  // Pages skipped above (invalid MDX, a client-boundary function prop, an id
  // collision) never entered `pages`, but the nav was projected from the raw
  // source config and may still reference their ids. Drop those dangling
  // references so `thally check` never reports a nav entry with no MDX file.
  docsConfig = pruneMissingNavigationPages(docsConfig, new Set(pages.map((page) => page.navigationId)))

  if (pages.length === 0) {
    const reasons = warnings.map((warning) => warning.message)
    throw new Error(reasons.length
      ? `No importable Markdown or MDX pages were found in the repository. Warnings encountered during migration:\n${reasons.map((reason) => `- ${reason}`).join('\n')}`
      : 'No importable Markdown or MDX pages were found in the repository.')
  }
  // Redirects and branding are global site config, extracted once at the
  // top-level Docusaurus call — `docusaurusSkipRedirects` already marks the
  // recursive per-plugin-instance sub-calls (community/mcp/agent-cli), which
  // would otherwise redundantly re-read (and re-warn about) the same config.
  const isTopLevelDocusaurus = platform === 'docusaurus' && docusaurusProjectRoot && !options.docusaurusSkipRedirects
  const themeColors = mintlifyConfig
    ? mintlifyThemeColors(mintlifyConfig.colors)
    : fernRawConfig
      ? fernThemeColors(fernRawConfig.colors)
      : isTopLevelDocusaurus ? readDocusaurusThemeColor(docusaurusProjectRoot!) : undefined
  // Thally's `SiteConfig` has no static logo/favicon field (unlike
  // `brand`/`brandPreset`, which the color pipeline above already wires):
  // branding is admin-managed at runtime. The referenced files are still
  // copied to `public/` by the ordinary asset scan, so name them and point
  // at where to wire them up manually instead of leaving the loss silent.
  // Fern already emits its own version of this warning (`fern.ts`).
  const brandAssetPaths = mintlifyConfig
    ? [...mintlifyBrandAssetPaths(mintlifyConfig.logo), ...mintlifyBrandAssetPaths(mintlifyConfig.favicon)]
    : isTopLevelDocusaurus ? readDocusaurusBrandAssetPaths(docusaurusProjectRoot!) : []
  if (brandAssetPaths.length > 0) {
    warnings.push({
      code: 'unsupported-config',
      message: `The site's logo/favicon (${brandAssetPaths.join(', ')}) were copied into public/ but are not wired into the migrated site's branding, which Thally manages from the admin dashboard rather than a static config field; set them there after the site is deployed.`,
    })
  }
  return {
    sourceUrl: options.sourceUrl,
    sourceKind: 'repository',
    platform,
    pages,
    assets,
    ...(componentMigrator ? { componentFiles: componentMigrator.files() } : {}),
    docsConfig,
    ...(mintlifyConfig ? {
      site: {
        ...(typeof mintlifyConfig.name === 'string' ? { name: mintlifyConfig.name } : {}),
        ...(typeof mintlifyConfig.description === 'string' ? { description: mintlifyConfig.description } : {}),
        ...(themeColors ? { colors: themeColors } : {}),
      },
    } : fernRawConfig && (typeof fernRawConfig.title === 'string' || themeColors) ? {
      site: {
        ...(typeof fernRawConfig.title === 'string' ? { name: fernRawConfig.title } : {}),
        ...(themeColors ? { colors: themeColors } : {}),
      },
    } : themeColors ? {
      site: { colors: themeColors },
    } : {}),
    warnings,
    stats: { discovered, imported: pages.length, skipped },
  }
}
