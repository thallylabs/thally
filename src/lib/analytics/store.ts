import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createClient, type Client, type InValue } from '@libsql/client'
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  AnalyticsRange,
  AnalyticsSummary,
  DailyTrafficPoint,
} from '@/lib/analytics/types'

const DATA_DIR = path.join(process.cwd(), '.data', 'analytics')
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'events.db')
const LEGACY_JSONL = path.join(DATA_DIR, 'events.jsonl')

const RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '6mo': 182,
  '1y': 365,
  '3y': 1095,
  // "All time" — a window wide enough to include every stored event; the
  // computed sinceMs goes negative, so `ts >= sinceMs` matches everything.
  'all': 100000,
}

type BucketUnit = 'day' | 'week' | 'month'

// Keep the traffic chart readable: fine-grained buckets for short windows,
// coarser for long ones (a 3-year window would otherwise be ~1,095 daily bars).
export function bucketUnitForDays(days: number): BucketUnit {
  if (days <= 92) return 'day' // 7 / 30 / 90 days
  if (days <= 550) return 'week' // 6 months, 1 year
  return 'month' // 3 years, all-time
}

// Bucket key for an event timestamp. All keys are UTC-derived (matching
// `dateKey`'s toISOString) so buckets never straddle days inconsistently.
// week → the Monday of that UTC week; month → the 1st of that UTC month.
export function bucketKey(ts: number, unit: BucketUnit): string {
  if (unit === 'day') return dateKey(ts)
  const d = new Date(ts)
  if (unit === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
  }
  // week: shift back to Monday (UTC)
  const sinceMonday = (d.getUTCDay() + 6) % 7 // 0 = Mon … 6 = Sun
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday))
  return monday.toISOString().slice(0, 10)
}

const INSERT_SQL = `INSERT OR IGNORE INTO analytics_events
  (id, ts, type, path, slug, visitor_type, agent_signal, format, referer, vote, page, query, result_count, clicked_slug)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/** Columns added after the initial schema — added via ALTER for existing DBs. */
const ADDED_COLUMNS: Array<[name: string, type: string]> = [
  ['query', 'TEXT'],
  ['result_count', 'INTEGER'],
  ['clicked_slug', 'TEXT'],
]

/**
 * Resolve the libSQL connection string. Defaults to an embedded on-disk file so
 * the store works with zero config locally; point `DOX_ANALYTICS_DB_URL` at a
 * Turso/libSQL URL (with `DOX_ANALYTICS_DB_TOKEN`) for a durable, serverless-safe
 * store in production.
 */
function resolveDbUrl(): { url: string; usingDefaultFile: boolean } {
  const configured = process.env.DOX_ANALYTICS_DB_URL?.trim()
  if (configured) return { url: configured, usingDefaultFile: false }
  return { url: `file:${DEFAULT_DB_FILE}`, usingDefaultFile: true }
}

/**
 * Ensure the parent directory exists for any on-disk libSQL file URL (the
 * default DB, or a custom `file:` URL via DOX_ANALYTICS_DB_URL). Skipped for
 * in-memory (`:memory:` / `file::memory:`) and remote (`libsql://`) targets,
 * which need no local directory.
 */
function ensureParentDir(url: string): void {
  if (!url.startsWith('file:')) return
  const filePath = url.slice('file:'.length)
  if (!filePath || filePath.startsWith(':')) return
  const dir = path.dirname(filePath)
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

let clientPromise: Promise<Client> | null = null

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { url, usingDefaultFile } = resolveDbUrl()
      ensureParentDir(url)
      const authToken = process.env.DOX_ANALYTICS_DB_TOKEN?.trim() || undefined
      const client = createClient({ url, authToken })

      await client.execute(`CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        slug TEXT,
        visitor_type TEXT,
        agent_signal TEXT,
        format TEXT,
        referer TEXT,
        vote TEXT,
        page TEXT,
        query TEXT,
        result_count INTEGER,
        clicked_slug TEXT
      )`)
      // Existing DBs predate the search columns — add them idempotently.
      for (const [name, columnType] of ADDED_COLUMNS) {
        try {
          await client.execute(`ALTER TABLE analytics_events ADD COLUMN ${name} ${columnType}`)
        } catch {
          // column already exists — ignore
        }
      }
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events (ts)`,
      )

      // Best-effort, one-time import of the legacy JSONL store. Only runs for the
      // local default file DB and only when the table is still empty, so it's
      // idempotent and never duplicates events.
      if (usingDefaultFile) {
        await migrateLegacyJsonl(client)
      }

      return client
    })()

    // If initialization fails (transient FS/network/auth), drop the cached
    // rejection so the next call retries instead of staying dead until restart.
    clientPromise.catch(() => {
      clientPromise = null
    })
  }
  return clientPromise
}

function eventToArgs(event: AnalyticsEvent): Array<InValue> {
  return [
    event.id,
    event.ts,
    event.type,
    event.path,
    event.slug ?? null,
    event.visitorType ?? null,
    event.agentSignal ?? null,
    event.format ?? null,
    event.referer ?? null,
    event.vote ?? null,
    event.page ?? null,
    event.query ?? null,
    event.resultCount ?? null,
    event.clickedSlug ?? null,
  ]
}

async function migrateLegacyJsonl(client: Client): Promise<void> {
  try {
    if (!fs.existsSync(LEGACY_JSONL)) return

    const existing = await client.execute('SELECT COUNT(*) AS n FROM analytics_events')
    const count = Number(existing.rows[0]?.n ?? 0)
    if (count > 0) return

    const raw = fs.readFileSync(LEGACY_JSONL, 'utf8')
    const events: Array<AnalyticsEvent> = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as AnalyticsEvent)
      } catch {
        // skip malformed lines
      }
    }
    if (events.length === 0) return

    // Import row-by-row so a single malformed record (e.g. a missing required
    // field) skips only itself rather than aborting the whole import.
    for (const event of events) {
      try {
        await client.execute({ sql: INSERT_SQL, args: eventToArgs(event) })
      } catch {
        // skip the bad row, keep the rest of the history
      }
    }
  } catch {
    // Migration is best-effort — never let it block the store from coming up.
  }
}

export async function trackAnalyticsEvent(
  partial: Omit<AnalyticsEvent, 'id' | 'ts'> & { ts?: number },
): Promise<AnalyticsEvent> {
  const event: AnalyticsEvent = {
    id: randomUUID(),
    ts: partial.ts ?? Date.now(),
    type: partial.type,
    path: partial.path,
    slug: partial.slug,
    visitorType: partial.visitorType,
    agentSignal: partial.agentSignal,
    format: partial.format,
    referer: partial.referer,
    vote: partial.vote,
    page: partial.page,
    query: partial.query,
    resultCount: partial.resultCount,
    clickedSlug: partial.clickedSlug,
  }

  const client = await getClient()
  await client.execute({ sql: INSERT_SQL, args: eventToArgs(event) })
  return event
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value)
}

async function readEventsSince(sinceMs: number): Promise<Array<AnalyticsEvent>> {
  const client = await getClient()
  const result = await client.execute({
    sql: 'SELECT * FROM analytics_events WHERE ts >= ? ORDER BY ts ASC',
    args: [sinceMs],
  })

  return result.rows.map((row) => ({
    id: String(row.id),
    ts: Number(row.ts),
    type: String(row.type) as AnalyticsEventType,
    path: String(row.path),
    slug: optionalString(row.slug),
    visitorType: optionalString(row.visitor_type) as AnalyticsEvent['visitorType'],
    agentSignal: optionalString(row.agent_signal) as AnalyticsEvent['agentSignal'],
    format: optionalString(row.format),
    referer: optionalString(row.referer),
    vote: optionalString(row.vote) as AnalyticsEvent['vote'],
    page: optionalString(row.page),
    query: optionalString(row.query),
    resultCount: row.result_count === null || row.result_count === undefined ? undefined : Number(row.result_count),
    clickedSlug: optionalString(row.clicked_slug),
  }))
}

function dateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export async function aggregateAnalytics(range: AnalyticsRange): Promise<AnalyticsSummary> {
  const days = RANGE_DAYS[range]
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
  const bucket = bucketUnitForDays(days)
  const events = await readEventsSince(sinceMs)

  const dailyMap = new Map<string, DailyTrafficPoint>()
  const humanPages = new Map<string, number>()
  const agentPages = new Map<string, number>()
  const signalCounts = new Map<string, number>()
  const searchTerms = new Map<string, number>()
  const zeroResultTerms = new Map<string, number>()

  let humanViews = 0
  let agentViews = 0
  let feedbackYes = 0
  let feedbackNo = 0
  let chatMessages = 0
  let discoveryHits = 0
  let totalSearches = 0
  let searchClicks = 0

  const recentFeedback: AnalyticsSummary['recentFeedback'] = []

  for (const event of events) {
    if (event.type === 'page_view' || event.type === 'api_fetch') {
      if (event.visitorType === 'agent') {
        agentViews++
        agentPages.set(event.path, (agentPages.get(event.path) ?? 0) + 1)
        if (event.agentSignal) {
          signalCounts.set(event.agentSignal, (signalCounts.get(event.agentSignal) ?? 0) + 1)
        }
      } else {
        humanViews++
        humanPages.set(event.path, (humanPages.get(event.path) ?? 0) + 1)
      }

      const key = bucketKey(event.ts, bucket)
      const point = dailyMap.get(key) ?? { date: key, human: 0, agent: 0, total: 0 }
      if (event.visitorType === 'agent') point.agent++
      else point.human++
      point.total++
      dailyMap.set(key, point)
    }

    if (event.type === 'discovery') {
      discoveryHits++
    }

    if (event.type === 'feedback') {
      if (event.vote === 'yes') feedbackYes++
      if (event.vote === 'no') feedbackNo++
      if (event.page) {
        recentFeedback.push({ ts: event.ts, page: event.page, vote: event.vote ?? 'no' })
      }
    }

    if (event.type === 'chat_message') {
      chatMessages++
    }

    if (event.type === 'search_query' && event.query) {
      const term = event.query.trim().toLowerCase()
      if (term) {
        if (event.clickedSlug) {
          searchClicks++ // a click on a result (separate event from the search)
        } else {
          totalSearches++
          searchTerms.set(term, (searchTerms.get(term) ?? 0) + 1)
          if (event.resultCount === 0) {
            zeroResultTerms.set(term, (zeroResultTerms.get(term) ?? 0) + 1)
          }
        }
      }
    }
  }

  recentFeedback.sort((a, b) => b.ts - a.ts)

  const dailyTraffic = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  function topPages(map: Map<string, number>) {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, views]) => ({ path, views }))
  }

  return {
    range,
    totals: {
      pageViews: humanViews + agentViews,
      humanViews,
      agentViews,
      feedbackYes,
      feedbackNo,
      chatMessages,
      discoveryHits,
    },
    dailyTraffic,
    topPages: {
      human: topPages(humanPages),
      agent: topPages(agentPages),
    },
    agentSignals: Array.from(signalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([signal, count]) => ({ signal, count })),
    recentFeedback: recentFeedback.slice(0, 20),
    search: {
      totalSearches,
      clickThroughRate: totalSearches > 0 ? Math.min(1, searchClicks / totalSearches) : 0,
      topTerms: Array.from(searchTerms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count })),
      zeroResults: Array.from(zeroResultTerms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([term, count]) => ({ term, count })),
    },
  }
}

/** Test-only: drop the cached client so a fresh DB is used per test. */
export function __resetAnalyticsStoreForTests(): void {
  clientPromise = null
}
