import type { MigrationDocsConfig, MigrationWarning } from './types.js'

/**
 * Mintlify analytics -> Thally `docs.json` `integrations`.
 *
 * Reads docs.json `integrations` and the legacy mint.json `analytics` block.
 * Values land in an inline script on the rendered site, so each is validated
 * here with the same patterns the renderer applies (src/lib/analytics-config.ts;
 * a test keeps the two in agreement). Invalid values are skipped with a warning,
 * never coerced, and no warning echoes a full value.
 */

export type MigrationIntegrations = NonNullable<MigrationDocsConfig['integrations']>

const GA4_ID = /^G-[A-Z0-9]{4,20}$/
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/
const POSTHOG_KEY = /^phc_[A-Za-z0-9]{20,64}$/
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})*$`)
const SAFE_PATH = /^\/[A-Za-z0-9._~\-/]*$/
const MAX_PLAUSIBLE_DOMAINS = 10

const SUPPORTED = ['ga4', 'gtm', 'posthog', 'plausible'] as const
/** Legacy mint.json spelling of GA4; same `measurementId` field. */
const LEGACY_GA4_ALIAS = 'googleAnalytics'

function own(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function redact(value: unknown): string {
  if (typeof value !== 'string') return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  // Printable ASCII only: control and line-separator characters must not reach logs or reports.
  return value.length === 0 ? 'empty string' : `"${value.trim().slice(0, 4).replace(/[^\x20-\x7e]/g, '?')}..." (${value.length} chars)`
}

/** Public DNS names only: no localhost, and no IP literal in any form `URL` normalises (`0x7f.1`, `2130706433`, `[::1]`). */
function isPublicHostname(hostname: string): boolean {
  return !/(^|\.)localhost$/.test(hostname) && !/(^|\.)\d+$/.test(hostname) && !hostname.includes(':') && !hostname.startsWith('[')
}

function normalizeHttpsUrl(value: string, allowPath: boolean): string | null {
  if (!/^https:\/\//i.test(value) || /[?#\\]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null
  if (!HOSTNAME.test(url.hostname) || !isPublicHostname(url.hostname) || url.port === '0') return null
  // Judge the path as written: URL parsing would silently resolve `..` segments.
  const fullPath = /^https:\/\/[^/]*(\/.*)?$/i.exec(value)?.[1] ?? ''
  if (fullPath.includes('//')) return null
  const path = fullPath.replace(/\/+$/, '')
  if (path && (!allowPath || !SAFE_PATH.test(path) || path.split('/').some((s) => s === '..' || s === '.'))) return null
  return `${url.origin}${path}`
}

function normalizeDomains(value: string): string | null {
  const parts = value.split(',').map((part) => part.trim().toLowerCase())
  if (parts.length > MAX_PLAUSIBLE_DOMAINS) return null
  return parts.every((part) => part.length <= 253 && HOSTNAME.test(part)) ? parts.join(',') : null
}

/** Bare hostname[:port] or an https origin; the script path is fixed by the renderer. */
function normalizeServer(value: string): string | null {
  if (/^https:\/\//i.test(value)) {
    const origin = normalizeHttpsUrl(value, false)
    return origin ? origin.replace(/^https:\/\//, '') : null
  }
  const bare = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(value)
  if (!bare || (bare[2] !== undefined && (Number(bare[2]) < 1 || Number(bare[2]) > 65_535))) return null
  const origin = normalizeHttpsUrl(`https://${bare[1].toLowerCase()}${bare[2] === undefined ? '' : `:${Number(bare[2])}`}`, false)
  return origin ? origin.replace(/^https:\/\//, '') : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 2_048 ? value.trim() : null
}

interface Source {
  label: string
  block: Record<string, unknown>
}

export function projectMintlifyIntegrations(config: Record<string, unknown>): {
  integrations?: MigrationIntegrations
  warnings: Array<MigrationWarning>
} {
  // Analytics is optional: an unreadable config (non-object, throwing getter)
  // must never fail the migration.
  if (!isRecord(config)) return { warnings: [] }
  try {
    return project(config)
  } catch {
    return { warnings: [{ code: 'unsupported-config', message: 'Mintlify analytics configuration could not be read; analytics were not imported.' }] }
  }
}

function project(config: Record<string, unknown>): {
  integrations?: MigrationIntegrations
  warnings: Array<MigrationWarning>
} {
  const warnings: Array<MigrationWarning> = []
  const warn = (message: string) => warnings.push({ code: 'unsupported-config', message })
  const sources: Array<Source> = []
  for (const [label, key] of [['integrations', 'integrations'], ['analytics', 'analytics']] as const) {
    const value = own(config, key)
    if (value === undefined) continue
    if (isRecord(value)) sources.push({ label, block: value })
    else warn(`Mintlify ${label} must be an object (found ${redact(value)}); analytics from it were not imported.`)
  }
  const integrations: MigrationIntegrations = {}

  // Sources are ordered docs.json `integrations` first, so it wins per provider.
  const pick = (name: (typeof SUPPORTED)[number]): Array<{ label: string; value: unknown }> => {
    const found: Array<{ label: string; value: unknown }> = []
    for (const source of sources) {
      let value = own(source.block, name)
      if (value === undefined && name === 'ga4' && source.label === 'analytics') value = own(source.block, LEGACY_GA4_ALIAS)
      if (value !== undefined) found.push({ label: `${source.label}.${name}`, value })
    }
    if (found.length > 1) {
      warn(`Mintlify ${found[0].label} and ${found[1].label} are both set; using ${found[0].label} for ${name}.`)
    }
    return found
  }

  const field = (label: string, block: Record<string, unknown>, key: string, required: boolean): string | null | undefined => {
    const raw = own(block, key)
    if (raw === undefined) {
      if (required) warn(`Mintlify ${label}.${key} is missing; ${label} was not imported.`)
      return required ? null : undefined
    }
    const value = text(raw)
    if (value === null) warn(`Mintlify ${label}.${key} is not a usable string (found ${redact(raw)}); ${label} was not imported.`)
    return value
  }

  const objectFor = (entry: { label: string; value: unknown }): Record<string, unknown> | null => {
    if (isRecord(entry.value)) return entry.value
    warn(`Mintlify ${entry.label} must be an object (found ${redact(entry.value)}); provider was not imported.`)
    return null
  }

  const ga4 = pick('ga4')[0]
  const ga4Block = ga4 ? objectFor(ga4) : null
  if (ga4 && ga4Block) {
    const id = field(ga4.label, ga4Block, 'measurementId', true)
    if (id && GA4_ID.test(id)) integrations.ga4 = { measurementId: id }
    else if (id) warn(`Mintlify ${ga4.label}.measurementId ${redact(id)} is not a GA4 ID (G-XXXXXXXXXX); Universal Analytics and lowercase IDs are not imported.`)
  }

  const gtm = pick('gtm')[0]
  const gtmBlock = gtm ? objectFor(gtm) : null
  if (gtm && gtmBlock) {
    const id = field(gtm.label, gtmBlock, 'tagId', true)
    if (id && GTM_ID.test(id)) integrations.gtm = { tagId: id }
    else if (id) warn(`Mintlify ${gtm.label}.tagId ${redact(id)} is not a GTM container ID (GTM-XXXXXXX); GTM was not imported.`)
  }

  const plausible = pick('plausible')[0]
  const plausibleBlock = plausible ? objectFor(plausible) : null
  if (plausible && plausibleBlock) {
    const domainRaw = field(plausible.label, plausibleBlock, 'domain', true)
    const serverRaw = field(plausible.label, plausibleBlock, 'server', false)
    const domain = domainRaw ? normalizeDomains(domainRaw) : null
    const server = serverRaw ? normalizeServer(serverRaw) : serverRaw
    if (domainRaw && !domain) warn(`Mintlify ${plausible.label}.domain ${redact(domainRaw)} must be hostname(s) without a protocol or path; Plausible was not imported.`)
    if (serverRaw && !server) warn(`Mintlify ${plausible.label}.server ${redact(serverRaw)} must be a hostname; Plausible was not imported.`)
    if (domain && server !== null) integrations.plausible = { domain, ...(server ? { server } : {}) }
  }

  const posthog = pick('posthog')[0]
  const posthogBlock = posthog ? objectFor(posthog) : null
  if (posthog && posthogBlock) {
    const key = field(posthog.label, posthogBlock, 'apiKey', true)
    const hostRaw = field(posthog.label, posthogBlock, 'apiHost', false)
    const host = hostRaw ? normalizeHttpsUrl(hostRaw, true) : hostRaw
    const recording = own(posthogBlock, 'sessionRecording')
    if (recording !== undefined && typeof recording !== 'boolean') warn(`Mintlify ${posthog.label}.sessionRecording must be a boolean (found ${redact(recording)}); session recording disabled.`)
    if (key && !POSTHOG_KEY.test(key)) warn(`Mintlify ${posthog.label}.apiKey ${redact(key)} is not a PostHog project key (phc_...); PostHog was not imported.`)
    if (hostRaw && !host) warn(`Mintlify ${posthog.label}.apiHost ${redact(hostRaw)} must be an https URL without credentials, query, or fragment; PostHog was not imported.`)
    if (key && POSTHOG_KEY.test(key) && host !== null) {
      integrations.posthog = {
        apiKey: key,
        ...(host ? { apiHost: host } : {}),
        // Fail closed: a present non-boolean value turns recording off.
        ...(recording !== undefined ? { sessionRecording: recording === true } : {}),
      }
    }
  }

  const unsupported = new Set<string>()
  for (const source of sources) {
    for (const key of Object.keys(source.block)) {
      if ((SUPPORTED as ReadonlyArray<string>).includes(key)) continue
      if (key === LEGACY_GA4_ALIAS && source.label === 'analytics') continue
      unsupported.add(/^[A-Za-z0-9_-]{1,40}$/.test(key) ? key : '(invalid name)')
    }
  }
  if (unsupported.size > 0) {
    const names = [...unsupported].slice(0, 30)
    warn(`Mintlify analytics/integration providers Thally cannot render were not imported: ${names.join(', ')}${unsupported.size > names.length ? ', ...' : ''}. Supported: ga4, gtm, posthog, plausible.`)
  }

  return { ...(Object.keys(integrations).length > 0 ? { integrations } : {}), warnings }
}

/**
 * Validate an authored Thally `docs.json` `integrations` value with the same
 * rules as the import and the renderer; one value-free message per problem.
 */
export function validateIntegrations(integrations: unknown): Array<string> {
  if (integrations === undefined) return []
  const result = projectMintlifyIntegrations({ integrations })
  const messages = result.warnings.map((warning) =>
    warning.message
      .replace(/^Mintlify analytics\/integration providers Thally cannot render were not imported: /, 'docs.json integrations: Thally does not support these providers, so they will not be rendered: ')
      .replace(/^Mintlify /, 'docs.json ').replace(/\b(?:was|were|are) not imported\b/g, 'will not be rendered'),
  )
  if (result.integrations?.ga4 && result.integrations.gtm) {
    messages.push('docs.json integrations enable both ga4 and gtm; a GA4 tag inside the GTM container would double-count page views.')
  }
  return messages
}
