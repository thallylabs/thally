/**
 * Opt-in reachability checks for external links (`thally check --external`).
 *
 * Network results are inherently flaky, so every finding is a warning and
 * never fails a check. The checker is bounded on every axis: unique URLs are
 * capped, requests run under a small concurrency limit and a per-request
 * timeout, redirects are not followed (a 3xx already proves the link resolves),
 * and response bodies are never read.
 *
 * Content is untrusted input, so the checker only contacts public hosts. A
 * host is skipped when it is an IP literal or a name that resolves to any
 * loopback, private, link-local, or otherwise non-global address, and the
 * request is pinned to the address that was validated so DNS cannot be
 * rebound between the check and the connection.
 */

import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import pLimit from 'p-limit'

import type { LintIssue } from './check.js'

/** One external link occurrence in authored content. */
export interface ExternalLinkReference {
  url: string
  file: string
  line?: number
}

export interface ResolvedAddress {
  address: string
  family: number
}

/** Issue a request to a validated, pinned address and return its status code. */
export type ExternalLinkRequester = (
  url: URL,
  method: 'HEAD' | 'GET',
  pinned: ResolvedAddress,
  timeoutMs: number,
) => Promise<number>

export interface ExternalLinkCheckOptions {
  /** Parallel requests (default 8). */
  concurrency?: number
  /** Per-request timeout in milliseconds (default 8000). */
  timeoutMs?: number
  /** Maximum unique URLs checked per run (default 300). */
  maxUrls?: number
  /** DNS resolver; injectable so tests never touch the network. */
  resolve?: (hostname: string) => Promise<Array<ResolvedAddress>>
  /** HTTP requester; injectable so tests never touch the network. */
  request?: ExternalLinkRequester
}

const DEFAULT_CONCURRENCY = 8
const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_URLS = 300
const USER_AGENT = 'Thally-Check/1.0 (+https://thally.io)'

/**
 * Global unicast addresses only. Mirrors the migration downloader's rule:
 * excludes loopback, RFC 1918, CGNAT, link-local, benchmarking, documentation,
 * multicast, unique-local, and IPv4-mapped IPv6 addresses.
 */
export function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    const [a, b] = parts
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 203 && b === 0)
      || (a === 198 && b === 51))
  }
  return family === 6 && /^[23][0-9a-f]{0,3}:/i.test(address)
    && !/^2001:db8:/i.test(address)
}

/** Hostnames that can only ever name a private or local machine. */
function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return !host.includes('.')
    || host === 'localhost'
    || /\.(?:localhost|local|internal|lan|home|corp|intranet|test|invalid|example)$/.test(host)
}

/** Parse a content link into a checkable URL, or null when it must be skipped. */
export function checkableUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Credentials in a link are never sent anywhere by the checker.
  if (url.username || url.password) return null
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) || isLocalHostname(hostname)) return null
  url.hash = ''
  return url
}

async function defaultResolve(hostname: string): Promise<Array<ResolvedAddress>> {
  return lookup(hostname, { all: true, verbatim: true })
}

const defaultRequest: ExternalLinkRequester = (url, method, pinned, timeoutMs) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(url, {
      method,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      // Node's dual-stack connector asks lookup for `all: true`; answer with
      // the validated address only so the connection cannot be redirected.
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [pinned])
        else callback(null, pinned.address, pinned.family)
      },
    }, (response: IncomingMessage) => {
      // Status is all the checker needs; never buffer a body.
      response.destroy()
      resolve(response.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })

type UrlOutcome =
  | { kind: 'ok' }
  | { kind: 'skipped' }
  | { kind: 'broken'; message: string }

async function checkOne(
  url: URL,
  resolveHost: NonNullable<ExternalLinkCheckOptions['resolve']>,
  send: ExternalLinkRequester,
  timeoutMs: number,
): Promise<UrlOutcome> {
  let addresses: Array<ResolvedAddress>
  try {
    addresses = await resolveHost(url.hostname)
  } catch {
    return { kind: 'broken', message: `host "${url.hostname}" did not resolve` }
  }
  if (addresses.length === 0) return { kind: 'broken', message: `host "${url.hostname}" did not resolve` }
  if (addresses.some((candidate) => !isPublicAddress(candidate.address, candidate.family))) {
    return { kind: 'skipped' }
  }
  const pinned = addresses[0]
  try {
    let status = await send(url, 'HEAD', pinned, timeoutMs)
    // Some servers reject HEAD outright; a GET (body discarded) is definitive.
    if (status === 405 || status === 501) status = await send(url, 'GET', pinned, timeoutMs)
    if (status >= 200 && status < 400) return { kind: 'ok' }
    // Authentication walls, bot defenses, and rate limits say nothing about
    // whether the page exists, so they are inconclusive rather than broken.
    if (status === 401 || status === 403 || status === 429 || status === 999) return { kind: 'skipped' }
    return { kind: 'broken', message: `returned HTTP ${status}` }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError'
      ? `timed out after ${timeoutMs}ms`
      : 'could not be reached'
    return { kind: 'broken', message: reason }
  }
}

/**
 * Check unique external links and return one warning per broken occurrence.
 * Skipped links (non-public hosts, inconclusive statuses) produce no issue.
 */
export async function checkExternalLinks(
  references: Array<ExternalLinkReference>,
  options: ExternalLinkCheckOptions = {},
): Promise<Array<LintIssue>> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxUrls = Math.max(0, options.maxUrls ?? DEFAULT_MAX_URLS)
  const resolveHost = options.resolve ?? defaultResolve
  const send = options.request ?? defaultRequest

  const occurrences = new Map<string, { url: URL; references: Array<ExternalLinkReference> }>()
  for (const reference of references) {
    const url = checkableUrl(reference.url)
    if (!url) continue
    const key = url.toString()
    const entry = occurrences.get(key) ?? { url, references: [] }
    entry.references.push(reference)
    occurrences.set(key, entry)
  }

  const entries = [...occurrences.values()]
  const checked = entries.slice(0, maxUrls)
  const limit = pLimit(concurrency)
  const outcomes = await Promise.all(checked.map((entry) => limit(() => checkOne(entry.url, resolveHost, send, timeoutMs))))

  const issues: Array<LintIssue> = []
  checked.forEach((entry, index) => {
    const outcome = outcomes[index]
    if (outcome.kind !== 'broken') return
    for (const reference of entry.references) {
      issues.push({
        severity: 'warning',
        message: `External link "${reference.url}" ${outcome.message}`,
        file: reference.file,
        line: reference.line,
      })
    }
  })
  if (entries.length > checked.length) {
    issues.push({
      severity: 'warning',
      message: `Checked the first ${checked.length} of ${entries.length} unique external links; the rest were not checked.`,
    })
  }
  return issues
}
