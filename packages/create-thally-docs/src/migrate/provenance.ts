/**
 * What produced a migration, recorded in `migration-report.json`: the command
 * line, the exact upstream commit of every source repository, and the engine
 * that ran. A later run can then be compared against it with one input changed
 * at a time. A git failure (no git, not a checkout, timeout) never fails a
 * migration: the commit is reported as `null` instead.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SourceProvenance {
  role: 'primary' | 'sourceRef'
  /** Public address only: no credentials, query or fragment, and `local-directory` for a checkout. */
  url: string
  /** Requested branch or tag; `HEAD` is the remote's default branch. */
  ref?: string
  /** Where a sourceRef repository is mounted in the site. */
  mountPath?: string
  /** Resolved commit, or `null` when the source is not a git checkout (a live site). */
  commit: string | null
  /** The working tree differed from `commit` (local checkouts only), so `commit` alone cannot reproduce the input. */
  dirty?: boolean
}

export interface EngineProvenance {
  name: string
  version: string
  /** Commit of the engine checkout, or `null` for an installed package. */
  commit: string | null
  dirty?: boolean
}

export interface GitHead {
  commit: string
  dirty: boolean
}

const ENGINE_PACKAGE = 'create-thally-docs'

/** Variables that point git at a repository other than the one in `-C`; a git hook or `git rebase --exec` exports them. */
const REPOSITORY_ENVIRONMENT = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX']

/**
 * Read-only git query. No optional locks and no fsmonitor, so inspecting a
 * user's checkout neither rewrites its index nor runs a command from its config.
 */
function git(directory: string, args: ReadonlyArray<string>): string | null {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPOSITORY_ENVIRONMENT.includes(name)))
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', directory, ...args], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * Commit checked out in `directory`, or `null` when it is not inside a git
 * checkout or git is unavailable. `atRoot` also requires `directory` to be the
 * checkout's own root, so a clone whose `.git` is gone cannot report the commit
 * of whatever repository its temporary folder happens to sit in.
 */
export function gitCommit(directory: string, { atRoot = false } = {}): string | null {
  if (atRoot && git(directory, ['rev-parse', '--show-prefix']) !== '') return null
  const commit = git(directory, ['rev-parse', '--verify', 'HEAD'])
  return commit && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null
}

/**
 * Commit plus whether the repository has uncommitted changes (ignored files are
 * not seen). A status that cannot be read counts as dirty: claiming a clean tree
 * is the error that makes a baseline look reproducible.
 */
export function gitHead(directory: string): GitHead | null {
  const commit = gitCommit(directory)
  return commit ? { commit, dirty: git(directory, ['status', '--porcelain']) !== '' } : null
}

/** Walk up from this module to the engine's own package.json; `src/` and `dist/` sit at different depths. */
function enginePackage(): { directory: string; version: string } | null {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown }
        if (manifest.name === ENGINE_PACKAGE && typeof manifest.version === 'string') return { directory, version: manifest.version }
      } catch {
        // An unrelated or unreadable manifest: keep walking.
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Engine version, plus its commit when the package is run from a Thally checkout. */
export function engineProvenance(): EngineProvenance {
  const engine = enginePackage()
  if (!engine) return { name: ENGINE_PACKAGE, version: 'unknown', commit: null }
  // An installed copy under someone's project (node_modules) is inside THEIR
  // repository; its HEAD says nothing about this engine. Only a checkout where
  // the package sits at packages/create-thally-docs counts.
  const head = git(engine.directory, ['rev-parse', '--show-prefix']) === `packages/${ENGINE_PACKAGE}/` ? gitHead(engine.directory) : null
  return head
    ? { name: ENGINE_PACKAGE, version: engine.version, commit: head.commit, dirty: head.dirty }
    : { name: ENGINE_PACKAGE, version: engine.version, commit: null }
}

/**
 * The command line as typed, without credentials: the `--api-key` value and any
 * URL's userinfo, query and fragment (a spec URL can carry a token), so the
 * report is as safe to commit as its own `sourceUrl`.
 */
export function redactArgv(argv: ReadonlyArray<string>): Array<string> {
  return argv.map((arg, index) => {
    if (argv[index - 1] === '--api-key') return '<redacted>'
    if (arg.startsWith('--api-key=')) return '--api-key=<redacted>'
    try {
      const url = new URL(arg)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && (url.username || url.password || url.search || url.hash)) return `${url.origin}${url.pathname}`
    } catch {
      // Not a URL: a flag, a path or an `owner/repo=mount` mapping, kept as typed.
    }
    return arg
  })
}
