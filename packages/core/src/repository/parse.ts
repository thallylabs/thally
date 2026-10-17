/**
 * Parse repository references from URLs, SSH remotes, and short specs.
 *
 * Invariants:
 * - A bare two-segment spec (`owner/repo`) always means github.com unless the
 *   caller explicitly selects another provider or host. Existing docs.json
 *   files and CLI habits depend on that.
 * - Three or more bare segments (`group/subgroup/project`) can only be GitLab.
 * - URLs carrying credentials or a non-default port are rejected, so a parsed
 *   reference can never smuggle a secret into a clone or API URL.
 * - Unknown hosts return null unless `fallbackProvider` is set. With a
 *   fallback the whole path is kept as the repository path, which preserves
 *   the long-standing behaviour of appending GitHub paths to any `repoUrl`.
 */

import { DEFAULT_GIT_HOSTS, defaultApiBaseUrl, findGitHost, normalizeGitHostname } from './hosts.js'
import type { GitProvider, GitProviderHost, RepositoryRef } from './types.js'

/** Options for {@link parseRepositoryReference}. */
export interface ParseRepositoryOptions {
  /** Recognised hosts; defaults to github.com and gitlab.com. */
  hosts?: ReadonlyArray<GitProviderHost>
  /** Provider for a bare spec, or the provider an unrecognised URL must have. */
  provider?: GitProvider
  /** Hostname for a bare spec, for example a self-hosted GitLab instance. */
  host?: string
  /** Treat URLs on unknown hosts as this provider instead of rejecting them. */
  fallbackProvider?: GitProvider
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/
/** GitLab allows 20 nested subgroups, so a project path has at most 21 segments. */
const MAX_GITLAB_SEGMENTS = 21
const SCP_REMOTE = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(?!\/\/)(.+)$/
const BARE_SPEC = /^([A-Za-z0-9_./-]+?)(?:([#!])(\d+))?$/

function isValidSegment(segment: string): boolean {
  return SEGMENT.test(segment) && segment !== '.' && segment !== '..'
}

function stripGitSuffix(segment: string): string {
  return segment.toLowerCase().endsWith('.git') ? segment.slice(0, -4) : segment
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function buildRef(
  host: GitProviderHost,
  segments: Array<string>,
  extra: Pick<RepositoryRef, 'ref' | 'path' | 'number'> = {},
): RepositoryRef | null {
  if (segments.length < 2) return null
  if (host.provider === 'github' && segments.length !== 2) return null
  if (host.provider === 'gitlab' && segments.length > MAX_GITLAB_SEGMENTS) return null
  const cleaned = [...segments]
  cleaned[cleaned.length - 1] = stripGitSuffix(cleaned[cleaned.length - 1])
  if (!cleaned.every(isValidSegment)) return null
  const repo = cleaned[cleaned.length - 1]
  const owner = cleaned.slice(0, -1).join('/')
  const ref: RepositoryRef = {
    provider: host.provider,
    host: host.host,
    origin: host.origin,
    apiBaseUrl: host.apiBaseUrl,
    owner,
    repo,
    fullPath: `${owner}/${repo}`,
  }
  if (extra.ref) ref.ref = extra.ref
  if (extra.path !== undefined && extra.ref) ref.path = extra.path
  if (extra.number !== undefined) ref.number = extra.number
  return ref
}

/** Split a GitHub path (`owner/repo/...`) into repository and location. */
function parseGithubPath(host: GitProviderHost, segments: Array<string>): RepositoryRef | null {
  const [owner, repo, kind, ...rest] = segments
  if (!owner || !repo) return null
  if (kind === undefined) return buildRef(host, [owner, repo])
  if ((kind === 'pull' || kind === 'pulls') && rest.length >= 1) {
    const number = positiveInt(rest[0])
    return number === undefined ? null : buildRef(host, [owner, repo], { number })
  }
  if ((kind === 'tree' || kind === 'blob' || kind === 'edit') && rest.length >= 1) {
    return buildRef(host, [owner, repo], { ref: rest[0], path: rest.slice(1).join('/') })
  }
  // Any other trailing path (issues, wiki, ...) still identifies the repository.
  return buildRef(host, [owner, repo])
}

const GITLAB_LOCATION_KINDS: Record<string, true> = { tree: true, blob: true, edit: true }

/** Split a GitLab path (`group/.../project/-/...`) into project and location. */
function parseGitlabPath(host: GitProviderHost, segments: Array<string>): RepositoryRef | null {
  let projectSegments = segments
  let location: Array<string> = []
  const separator = segments.indexOf('-')
  if (separator >= 0) {
    projectSegments = segments.slice(0, separator)
    location = segments.slice(separator + 1)
  } else {
    // Legacy URLs without `/-/`: only `tree`/`blob` after at least two segments.
    const legacy = segments.findIndex((segment, index) => index >= 2 && (segment === 'tree' || segment === 'blob'))
    if (legacy >= 0) {
      projectSegments = segments.slice(0, legacy)
      location = segments.slice(legacy)
    }
  }
  const [kind, ...rest] = location
  if (kind === 'merge_requests' && rest.length >= 1) {
    const number = positiveInt(rest[0])
    return number === undefined ? null : buildRef(host, projectSegments, { number })
  }
  if (kind && GITLAB_LOCATION_KINDS[kind] && rest.length >= 1) {
    // Branch names may contain `/`; without an API call the first segment is
    // taken as the branch. Callers expose a `--branch` override for that case.
    return buildRef(host, projectSegments, { ref: rest[0], path: rest.slice(1).join('/') })
  }
  return buildRef(host, projectSegments)
}

function fallbackHost(hostname: string, origin: string, provider: GitProvider): GitProviderHost {
  return { host: hostname, provider, origin, apiBaseUrl: defaultApiBaseUrl(provider, hostname, origin) }
}

function hostForBareSpec(
  segmentCount: number,
  options: ParseRepositoryOptions,
  hosts: ReadonlyArray<GitProviderHost>,
): GitProviderHost | null {
  if (options.host) {
    const hostname = normalizeGitHostname(options.host)
    if (!hostname) return null
    const known = findGitHost(hostname, hosts)
    if (known) return options.provider && known.provider !== options.provider ? { ...known, provider: options.provider } : known
    const provider = options.provider ?? options.fallbackProvider
    return provider ? fallbackHost(hostname, `https://${hostname}`, provider) : null
  }
  const provider: GitProvider = options.provider ?? (segmentCount >= 3 ? 'gitlab' : 'github')
  const defaultHost = provider === 'github' ? 'github.com' : 'gitlab.com'
  return findGitHost(defaultHost, hosts) ?? findGitHost(defaultHost, DEFAULT_GIT_HOSTS)
}

function parseBareSpec(
  input: string,
  options: ParseRepositoryOptions,
  hosts: ReadonlyArray<GitProviderHost>,
): RepositoryRef | null {
  const match = BARE_SPEC.exec(input)
  if (!match) return null
  const segments = match[1].split('/')
  if (segments.some((segment) => segment.length === 0)) return null
  const host = hostForBareSpec(segments.length, options, hosts)
  if (!host) return null
  const number = positiveInt(match[3])
  if (match[2] === '#' && host.provider !== 'github') return null
  if (match[2] === '!' && host.provider !== 'gitlab') return null
  return buildRef(host, segments, number === undefined ? {} : { number })
}

function parsePathForHost(host: GitProviderHost, rawPath: string, isFallback: boolean): RepositoryRef | null {
  const segments = rawPath.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
  if (isFallback) {
    // Unknown host: keep the whole path so builders reproduce the configured URL.
    if (segments.length < 2) return null
    const cleaned = [...segments]
    cleaned[cleaned.length - 1] = stripGitSuffix(cleaned[cleaned.length - 1])
    if (!cleaned.every(isValidSegment)) return null
    const repo = cleaned[cleaned.length - 1]
    const owner = cleaned.slice(0, -1).join('/')
    return {
      provider: host.provider,
      host: host.host,
      origin: host.origin,
      apiBaseUrl: host.apiBaseUrl,
      owner,
      repo,
      fullPath: `${owner}/${repo}`,
    }
  }
  return host.provider === 'github' ? parseGithubPath(host, segments) : parseGitlabPath(host, segments)
}

function parseUrlReference(
  url: URL,
  options: ParseRepositoryOptions,
  hosts: ReadonlyArray<GitProviderHost>,
): RepositoryRef | null {
  if (url.username || url.password) return null
  if (url.port) return null
  const hostname = url.hostname.toLowerCase()
  const known = findGitHost(hostname, hosts)
  if (known) {
    const origin = url.protocol === 'http:' ? `http://${known.host}` : known.origin
    const host = { ...known, origin }
    if (options.provider && options.provider !== known.provider) return null
    return parsePathForHost(host, url.pathname, false)
  }
  const provider = options.provider ?? options.fallbackProvider
  if (!provider) return null
  return parsePathForHost(fallbackHost(hostname, url.origin, provider), url.pathname, true)
}

/**
 * Parse a repository reference.
 *
 * Accepts `https://host/owner/repo` (with `.git`, tree, blob, edit, pull, or
 * merge-request suffixes), `git@host:owner/repo.git`, `ssh://git@host/owner/repo`,
 * `host/owner/repo` for recognised hosts, `owner/repo`, `owner/repo#12`,
 * `group/subgroup/project`, and `group/project!12`.
 *
 * Returns null rather than throwing for anything it cannot interpret safely.
 */
export function parseRepositoryReference(
  input: string,
  options: ParseRepositoryOptions = {},
): RepositoryRef | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!value || /\s/.test(value)) return null
  const hosts = options.hosts ?? DEFAULT_GIT_HOSTS

  const scp = SCP_REMOTE.exec(value)
  if (scp) {
    const known = findGitHost(scp[1], hosts)
    if (!known) {
      const provider = options.provider ?? options.fallbackProvider
      const hostname = normalizeGitHostname(scp[1])
      if (!provider || !hostname) return null
      return parsePathForHost(fallbackHost(hostname, `https://${hostname}`, provider), scp[2], false)
    }
    return parsePathForHost(known, scp[2], false)
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (url.protocol === 'ssh:' || url.protocol === 'git+ssh:') {
      // SSH ports and users are irrelevant to identity; only the host matters.
      const known = findGitHost(url.hostname, hosts)
      const provider = options.provider ?? options.fallbackProvider
      const hostname = normalizeGitHostname(url.hostname)
      if (!known && (!provider || !hostname)) return null
      const host = known ?? fallbackHost(hostname as string, `https://${hostname}`, provider as GitProvider)
      return parsePathForHost(host, url.pathname, false)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return parseUrlReference(url, options, hosts)
  }

  // `github.com/owner/repo` without a scheme, for recognised hosts only.
  const firstSlash = value.indexOf('/')
  if (firstSlash > 0) {
    const candidateHost = value.slice(0, firstSlash)
    if (candidateHost.includes('.') && findGitHost(candidateHost, hosts)) {
      try {
        return parseUrlReference(new URL(`https://${value}`), options, hosts)
      } catch {
        return null
      }
    }
  }

  return parseBareSpec(value, options, hosts)
}
