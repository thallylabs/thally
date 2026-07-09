// ---------------------------------------------------------------------------
// Dox Track — shared commit distiller.
//
// Turns a commit (or push range) in a tracked product repo into the material a
// docs task needs: the GitHub API fetchers, the path-glob filter, and the
// instruction/context builder. Dependency-free on purpose: this module is
// consumed by the MCP `sync_from_repo` tool, `@doxlabs/agent` (commit context),
// `@doxlabs/cli` (`dox track`), and the Next.js webhook receiver — one source
// of truth for how a commit becomes a task (exported as `@doxlabs/mcp/track`).
// ---------------------------------------------------------------------------

export interface OwnerRepoRef {
  owner: string
  repo: string
  /** Present when the spec pinned a commit (`owner/repo@sha`). */
  sha?: string
}

/**
 * Parse a tracked-repo spec: `owner/repo`, `owner/repo@sha`, or a github.com
 * URL (`https://github.com/owner/repo(.git)`). Returns null for anything else.
 */
export function parseOwnerRepo(spec: string): OwnerRepoRef | null {
  const trimmed = spec.trim()
  // Capture a pinned commit sha from a /commit/<sha> (or /tree/<sha>) URL path
  // BEFORE the trailing catch-all, so it isn't silently discarded.
  const url = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(?:commit|tree)\/([0-9a-fA-F]{4,40}))?(?:[/#?].*)?$/i,
  )
  if (url) return { owner: url[1], repo: url[2], ...(url[3] ? { sha: url[3] } : {}) }
  const plain = trimmed.match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:@([0-9a-fA-F]{4,40}))?$/)
  if (!plain) return null
  return { owner: plain[1], repo: plain[2], ...(plain[3] ? { sha: plain[3] } : {}) }
}

export interface CommitFile {
  filename: string
  /** GitHub status: added | removed | modified | renamed | … */
  status: string
  additions: number
  deletions: number
  /** Unified diff hunk; absent for binary or very large files. */
  patch?: string
}

export interface CommitInfo {
  sha: string
  message: string
  author?: string
  htmlUrl?: string
  files: Array<CommitFile>
}

export interface GithubFetchOptions {
  /** Overrides the env token chain. */
  token?: string
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch
}

/** House token chain (same order the docs-task queue uses). */
function resolveToken(explicit?: string): string | undefined {
  return (
    explicit ??
    process.env.DOX_GITHUB_TOKEN ??
    process.env.DOX_TASKS_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN ??
    undefined
  )
}

async function githubJson<T>(path: string, options?: GithubFetchOptions): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const token = resolveToken(options?.token)
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetchImpl(`https://api.github.com${path}`, { headers })
  if (!response.ok) {
    const hint =
      response.status === 404 || response.status === 403
        ? ' (private repo or rate limit? set DOX_GITHUB_TOKEN)'
        : ''
    throw new Error(`GitHub API ${response.status} for ${path}${hint}`)
  }
  return (await response.json()) as T
}

interface RawCommit {
  sha: string
  html_url?: string
  commit?: { message?: string; author?: { name?: string } }
  author?: { login?: string } | null
  files?: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
}

function toCommitInfo(raw: RawCommit): CommitInfo {
  return {
    sha: raw.sha,
    message: raw.commit?.message ?? '',
    author: raw.author?.login ?? raw.commit?.author?.name,
    htmlUrl: raw.html_url,
    files: (raw.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.patch ? { patch: f.patch } : {}),
    })),
  }
}

/** Fetch a single commit with per-file patches. */
export async function fetchCommit(
  owner: string,
  repo: string,
  ref: string,
  options?: GithubFetchOptions,
): Promise<CommitInfo> {
  const raw = await githubJson<RawCommit>(`/repos/${owner}/${repo}/commits/${ref}`, options)
  return toCommitInfo(raw)
}

/**
 * Fetch the aggregate diff of a push range (`base...head`) — used when a push
 * carries multiple commits, so the task covers the whole range at once.
 */
export async function fetchCompare(
  owner: string,
  repo: string,
  base: string,
  head: string,
  options?: GithubFetchOptions,
): Promise<CommitInfo> {
  const raw = await githubJson<{ files?: RawCommit['files']; commits?: Array<RawCommit> }>(
    `/repos/${owner}/${repo}/compare/${base}...${head}`,
    options,
  )
  const headCommit = raw.commits?.[raw.commits.length - 1]
  return {
    sha: headCommit?.sha ?? head,
    message: headCommit?.commit?.message ?? `Changes ${base.slice(0, 7)}...${head.slice(0, 7)}`,
    author: headCommit?.author?.login ?? headCommit?.commit?.author?.name,
    htmlUrl: headCommit?.html_url,
    files: (raw.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      ...(f.patch ? { patch: f.patch } : {}),
    })),
  }
}

/** The repo's default branch (e.g. main/master/develop) — for sha-less specs. */
export async function fetchDefaultBranch(
  owner: string,
  repo: string,
  options?: GithubFetchOptions,
): Promise<string> {
  const raw = await githubJson<{ default_branch?: string }>(`/repos/${owner}/${repo}`, options)
  return raw.default_branch ?? 'main'
}

/**
 * Compile a `**`-aware glob to an anchored RegExp: `**` crosses path segments,
 * `*` matches within one segment, `?` a single character. No negation or braces.
 */
function compileGlob(pattern: string): RegExp {
  const normalized = pattern.replace(/^\.\//, '')
  let regex = ''
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        // `**/` may match zero directories; bare `**` matches anything.
        if (normalized[i + 2] === '/') {
          regex += '(?:[^/]+/)*'
          i += 2
        } else {
          regex += '.*'
          i += 1
        }
      } else {
        regex += '[^/]*'
      }
    } else if (char === '?') {
      regex += '[^/]'
    } else {
      regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${regex}$`)
}

/** Single glob check (compiles on each call — use filterFilesByGlobs for many files). */
export function matchesGlob(pattern: string, filePath: string): boolean {
  return compileGlob(pattern).test(filePath.replace(/^\.\//, ''))
}

/**
 * Filter files by path globs; absent/empty globs match everything. Each glob is
 * compiled once (M compilations), not once per file (N×M) — matters on large
 * monorepo pushes handled in the webhook request path.
 */
export function filterFilesByGlobs<T extends { filename: string }>(
  files: Array<T>,
  globs?: Array<string>,
): Array<T> {
  if (!globs || globs.length === 0) return files
  const compiled = globs.map(compileGlob)
  return files.filter((file) => {
    const path = file.filename.replace(/^\.\//, '')
    return compiled.some((re) => re.test(path))
  })
}

export interface TrackedRepoLike {
  owner: string
  repo: string
  branch?: string
  paths?: Array<string>
  outputTab?: string
  outputGroup?: string
}

/** Same context budget the agent's other context builders use. */
export const TRACK_CONTEXT_CHAR_CAP = 20000

/**
 * The one-line instruction for a tracked commit. Pure (no network) and free of
 * shell-metacharacter wrapping — it is dispatched through GitHub Actions where
 * it lands in a shell, so it must never embed quotes that could break (or be
 * injected into) the run script; the receiver reads it from an env var.
 *
 * The instruction frames the agent's actual job: judge what user-facing
 * behavior the change affects and update the docs that describe it — not to
 * maintain any source-file→page mapping.
 */
export function buildTrackInstruction(
  repo: TrackedRepoLike,
  commit: Pick<CommitInfo, 'sha' | 'message'>,
): string {
  const shortSha = commit.sha.slice(0, 7)
  const firstLine = commit.message.split('\n')[0]?.trim() || 'code changes'
  const placement = repo.outputTab
    ? ` If new pages are warranted, add them under the ${repo.outputTab} tab${repo.outputGroup ? ` (${repo.outputGroup} group)` : ''}.`
    : ''
  return (
    `A change landed in ${repo.owner}/${repo.repo}@${shortSha} (${firstLine}).` +
    ` Review the diff and decide what user-facing behavior it changes (API surface, config, CLI, defaults, behavior).` +
    ` Then find the documentation pages that describe that behavior and update them so the docs match — editing existing pages in place where they already cover it.${placement}` +
    ` Make no change if the diff has no user-facing impact.`
  )
}

/** The capped markdown diff context for a tracked commit. */
export function buildTrackContext(repo: Pick<TrackedRepoLike, 'owner' | 'repo'>, commit: CommitInfo): string {
  const header = [
    `# Tracked commit ${repo.owner}/${repo.repo}@${commit.sha.slice(0, 7)}`,
    commit.author ? `Author: ${commit.author}` : null,
    commit.htmlUrl ? `URL: ${commit.htmlUrl}` : null,
    '',
    commit.message,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n')

  // Reserve room for the truncation note so the final cap never slices it off.
  const NOTE_RESERVE = 100
  let context = header
  for (const file of commit.files) {
    const section = [
      `### ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})`,
      file.patch ? `\`\`\`diff\n${file.patch}\n\`\`\`` : '_(no text diff — binary or too large)_',
      '',
    ].join('\n')
    if (context.length + section.length > TRACK_CONTEXT_CHAR_CAP - NOTE_RESERVE) {
      context += `\n_(diff truncated — ${commit.files.length} file(s) total)_\n`
      break
    }
    context += section
  }
  return context.slice(0, TRACK_CONTEXT_CHAR_CAP)
}

/**
 * Distill a commit into the docs task the agent runs: a one-line instruction
 * (output routing + provenance directive) and a capped markdown diff context.
 */
export function buildTrackTask(
  repo: TrackedRepoLike,
  commit: CommitInfo,
): { instruction: string; context: string } {
  return { instruction: buildTrackInstruction(repo, commit), context: buildTrackContext(repo, commit) }
}
