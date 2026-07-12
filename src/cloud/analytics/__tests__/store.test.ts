import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  aggregateAnalytics,
  trackAnalyticsEvent,
  bucketUnitForDays,
  bucketKey,
  __resetAnalyticsStoreForTests,
} from '@/cloud/analytics/store'

describe('analytics store', () => {
  beforeEach(() => {
    // Isolate each test in its own in-memory libSQL database.
    process.env.THALLY_ANALYTICS_DB_URL = ':memory:'
    __resetAnalyticsStoreForTests()
  })

  afterEach(() => {
    __resetAnalyticsStoreForTests()
    delete process.env.THALLY_ANALYTICS_DB_URL
  })

  it('aggregates human and agent page views', async () => {
    const now = Date.now()
    await trackAnalyticsEvent({ type: 'page_view', path: '/guides/foo', visitorType: 'human', ts: now })
    await trackAnalyticsEvent({ type: 'page_view', path: '/guides/foo', visitorType: 'agent', agentSignal: 'user_agent', ts: now })
    await trackAnalyticsEvent({ type: 'feedback', path: '/guides/foo', page: '/guides/foo', vote: 'yes', visitorType: 'human', ts: now })

    const summary = await aggregateAnalytics('7d')
    expect(summary.totals.pageViews).toBe(2)
    expect(summary.totals.humanViews).toBe(1)
    expect(summary.totals.agentViews).toBe(1)
    expect(summary.totals.feedbackYes).toBe(1)
    expect(summary.agentSignals[0]?.signal).toBe('user_agent')
  })

  it('aggregates search queries, content gaps, and click-through', async () => {
    const now = Date.now()
    await trackAnalyticsEvent({ type: 'search_query', path: '/api/search', query: 'auth', resultCount: 3, ts: now })
    await trackAnalyticsEvent({ type: 'search_query', path: '/api/search', query: 'Auth', resultCount: 3, ts: now })
    await trackAnalyticsEvent({ type: 'search_query', path: '/api/search', query: 'pricing', resultCount: 0, ts: now })
    await trackAnalyticsEvent({ type: 'search_query', path: '/api/search', query: 'auth', clickedSlug: 'guides/auth', ts: now })

    const summary = await aggregateAnalytics('7d')
    expect(summary.search.totalSearches).toBe(3)
    expect(summary.search.topTerms[0]).toEqual({ term: 'auth', count: 2 })
    expect(summary.search.zeroResults[0]).toEqual({ term: 'pricing', count: 1 })
    expect(summary.search.clickThroughRate).toBeCloseTo(1 / 3, 5)
  })

  it('excludes events outside the requested range', async () => {
    const now = Date.now()
    const old = now - 40 * 24 * 60 * 60 * 1000
    await trackAnalyticsEvent({ type: 'page_view', path: '/recent', visitorType: 'human', ts: now })
    await trackAnalyticsEvent({ type: 'page_view', path: '/stale', visitorType: 'human', ts: old })

    const summary = await aggregateAnalytics('7d')
    expect(summary.totals.pageViews).toBe(1)
    expect(summary.topPages.human[0]?.path).toBe('/recent')
  })

  it('includes older events only within a matching longer window', async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    await trackAnalyticsEvent({ type: 'page_view', path: '/recent', visitorType: 'human', ts: now })
    await trackAnalyticsEvent({ type: 'page_view', path: '/200d', visitorType: 'human', ts: now - 200 * day })
    await trackAnalyticsEvent({ type: 'page_view', path: '/400d', visitorType: 'human', ts: now - 400 * day })

    expect((await aggregateAnalytics('90d')).totals.pageViews).toBe(1) // only /recent
    expect((await aggregateAnalytics('6mo')).totals.pageViews).toBe(1) // 182d < 200d
    expect((await aggregateAnalytics('1y')).totals.pageViews).toBe(2) // + /200d
    expect((await aggregateAnalytics('3y')).totals.pageViews).toBe(3) // + /400d
    expect((await aggregateAnalytics('all')).totals.pageViews).toBe(3)
  })

  it('chooses bucket granularity by window length', () => {
    expect(bucketUnitForDays(30)).toBe('day')
    expect(bucketUnitForDays(90)).toBe('day')
    expect(bucketUnitForDays(182)).toBe('week')
    expect(bucketUnitForDays(365)).toBe('week')
    expect(bucketUnitForDays(1095)).toBe('month')
    expect(bucketUnitForDays(100000)).toBe('month')
  })

  it('buckets timestamps to UTC day / Monday-week / month-start', () => {
    const wed = Date.parse('2026-07-08T15:00:00Z') // a Wednesday, UTC
    expect(bucketKey(wed, 'day')).toBe('2026-07-08')
    expect(bucketKey(wed, 'week')).toBe('2026-07-06') // Monday of that week
    expect(bucketKey(wed, 'month')).toBe('2026-07-01')
  })

  it('coarsens the traffic series for longer ranges', async () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    // Three events on three distinct recent days (all inside every window here).
    for (const offset of [0, 1, 2]) {
      await trackAnalyticsEvent({ type: 'page_view', path: '/a', visitorType: 'human', ts: now - offset * day })
    }
    const dayBuckets = (await aggregateAnalytics('30d')).dailyTraffic.length
    const weekBuckets = (await aggregateAnalytics('6mo')).dailyTraffic.length
    const monthBuckets = (await aggregateAnalytics('3y')).dailyTraffic.length
    expect(dayBuckets).toBe(3) // day granularity → one point per distinct day
    expect(weekBuckets).toBeLessThanOrEqual(dayBuckets) // coarser can only collapse points
    expect(monthBuckets).toBeLessThanOrEqual(weekBuckets)
  })

  it('persists events across a client reset (durable store)', async () => {
    // :memory: is per-connection, so use a temp file to prove durability.
    const file = `file:${process.cwd()}/.data/analytics/__test_durable_${Date.now()}.db`
    process.env.THALLY_ANALYTICS_DB_URL = file
    __resetAnalyticsStoreForTests()

    const now = Date.now()
    await trackAnalyticsEvent({ type: 'page_view', path: '/durable', visitorType: 'agent', ts: now })

    // Simulate a new serverless instance picking up the same store.
    __resetAnalyticsStoreForTests()
    const summary = await aggregateAnalytics('7d')
    expect(summary.totals.agentViews).toBe(1)

    // Clean up the temp database files.
    const fs = await import('node:fs')
    for (const suffix of ['', '-shm', '-wal']) {
      const p = file.replace('file:', '') + suffix
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
  })
})
