/**
 * Known repository hosts and the configuration that extends them.
 *
 * github.com and gitlab.com are recognised without configuration. Self-hosted
 * instances must be declared, because a hostname alone cannot say whether a
 * server runs GitLab or GitHub Enterprise. Invalid declarations are dropped
 * rather than thrown so a typo in configuration never breaks page rendering.
 */

import type { GitHostConfig, GitProvider, GitProviderHost } from './types.js'

const PROVIDERS: Record<GitProvider, true> = { github: true, gitlab: true }
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/

/** Hosts recognised without any configuration. */
export const DEFAULT_GIT_HOSTS: ReadonlyArray<GitProviderHost> = Object.freeze([
  Object.freeze({
    host: 'github.com',
    provider: 'github' as const,
    origin: 'https://github.com',
    apiBaseUrl: 'https://api.github.com',
  }),
  Object.freeze({
    host: 'gitlab.com',
    provider: 'gitlab' as const,
    origin: 'https://gitlab.com',
    apiBaseUrl: 'https://gitlab.com/api/v4',
  }),
])

/** True for the provider names Thally supports. */
export function isGitProvider(value: unknown): value is GitProvider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value)
}

/** Lower-case and validate a bare hostname; returns null for anything with a scheme, port, or path. */
export function normalizeGitHostname(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  return HOSTNAME_PATTERN.test(host) ? host : null
}

/** Default REST API base for a provider on a given origin. */
export function defaultApiBaseUrl(provider: GitProvider, host: string, origin: string): string {
  if (provider === 'github') return host === 'github.com' ? 'https://api.github.com' : `${origin}/api/v3`
  return `${origin}/api/v4`
}

function safeApiBaseUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** Resolve one declaration, or null when it is invalid. */
export function toGitProviderHost(config: GitHostConfig): GitProviderHost | null {
  if (!config || !isGitProvider(config.provider) || typeof config.host !== 'string') return null
  const host = normalizeGitHostname(config.host)
  if (!host) return null
  const origin = `https://${host}`
  return {
    host,
    provider: config.provider,
    origin,
    apiBaseUrl: safeApiBaseUrl(config.apiBaseUrl) ?? defaultApiBaseUrl(config.provider, host, origin),
  }
}

/**
 * Combine the default hosts with declared ones. A declaration for a default
 * host replaces it, which lets a deployment point gitlab.com at a proxy API.
 */
export function resolveGitHosts(extra?: ReadonlyArray<GitHostConfig> | null): ReadonlyArray<GitProviderHost> {
  if (!extra || extra.length === 0) return DEFAULT_GIT_HOSTS
  const byHost = new Map<string, GitProviderHost>(DEFAULT_GIT_HOSTS.map((entry) => [entry.host, entry]))
  for (const config of extra) {
    const resolved = toGitProviderHost(config)
    if (resolved) byHost.set(resolved.host, resolved)
  }
  return [...byHost.values()]
}

/**
 * Parse `THALLY_GIT_HOSTS`-style values: comma- or whitespace-separated
 * `host=provider` pairs, for example `gitlab.example.com=gitlab`.
 * Malformed entries are skipped.
 */
export function parseGitHostsEnv(value: string | null | undefined): Array<GitHostConfig> {
  if (!value) return []
  const configs: Array<GitHostConfig> = []
  for (const entry of value.split(/[\s,]+/)) {
    const [rawHost, rawProvider, ...rest] = entry.split('=')
    if (rest.length > 0 || !rawHost || !rawProvider) continue
    const provider = rawProvider.trim().toLowerCase()
    const host = normalizeGitHostname(rawHost)
    if (!host || !isGitProvider(provider)) continue
    configs.push({ host, provider })
  }
  return configs
}

/**
 * Read host declarations from a docs.json-shaped value
 * (`{ repository: { hosts: [...] } }`). Tolerates any input shape.
 */
export function readGitHostsConfig(docsJson: unknown): Array<GitHostConfig> {
  if (!docsJson || typeof docsJson !== 'object') return []
  const repository = (docsJson as { repository?: unknown }).repository
  if (!repository || typeof repository !== 'object') return []
  const hosts = (repository as { hosts?: unknown }).hosts
  if (!Array.isArray(hosts)) return []
  return hosts.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const candidate = entry as Partial<GitHostConfig>
    const resolved = toGitProviderHost(candidate as GitHostConfig)
    if (!resolved) return []
    return [{
      host: resolved.host,
      provider: resolved.provider,
      ...(typeof candidate.apiBaseUrl === 'string' ? { apiBaseUrl: resolved.apiBaseUrl } : {}),
    }]
  })
}

/** Look up a hostname among resolved hosts. `www.` is ignored for matching. */
export function findGitHost(
  hostname: string,
  hosts: ReadonlyArray<GitProviderHost> = DEFAULT_GIT_HOSTS,
): GitProviderHost | null {
  const host = hostname.trim().toLowerCase()
  const bare = host.startsWith('www.') ? host.slice(4) : host
  return hosts.find((entry) => entry.host === host) ?? hosts.find((entry) => entry.host === bare) ?? null
}
