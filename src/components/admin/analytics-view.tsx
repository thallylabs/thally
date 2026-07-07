'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AnalyticsRange, AnalyticsSummary } from '@/lib/analytics/types'
import type { ContentGap } from '@/lib/chat-insights'

type AnalyticsData = AnalyticsSummary & { contentGaps?: Array<ContentGap> }

const RANGES: Array<{ id: AnalyticsRange; label: string }> = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '6mo', label: '6mo' },
  { id: '1y', label: '1y' },
  { id: '3y', label: '3y' },
  { id: 'all', label: 'All' },
]

function niceMax(value: number): number {
  if (value <= 5) return 5
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  const scaled = value / pow
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return step * pow
}

function StatCard({
  label,
  value,
  hint,
  modifier,
}: {
  label: string
  value: string | number
  hint?: ReactNode
  modifier?: string
}) {
  return (
    <div className={cn('ds-stat-card', modifier)}>
      <span className="ds-stat-card-label">{label}</span>
      <span className="ds-stat-card-value">{value}</span>
      {hint ? <div className="ds-stat-card-footer">{hint}</div> : null}
    </div>
  )
}

function TrafficChart({ data }: { data: AnalyticsSummary['dailyTraffic'] }) {
  const max = niceMax(Math.max(...data.map((d) => d.total), 1))
  const gridLines = [1, 0.75, 0.5, 0.25, 0]
  // Show at most ~6 evenly-spaced date ticks so the axis never crowds.
  const tickEvery = Math.max(1, Math.ceil(data.length / 6))

  return (
    <div className="ds-panel">
      <div className="ds-panel-head">
        <div>
          <div className="ds-panel-title">Traffic over time</div>
          <div className="ds-panel-sub">Human vs agent</div>
        </div>
        <div className="flex items-center gap-4" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--ds-series-1)' }} /> Human
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--ds-series-2)' }} /> Agent
          </span>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-56 items-center justify-center" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          No traffic recorded yet for this range.
        </div>
      ) : (
        <div className="ds-chart">
          {/* Gridlines + y labels */}
          <div className="ds-chart-plot">
            {gridLines.map((g) => (
              <div key={g} className="ds-chart-gridline" style={{ bottom: `${g * 100}%` }}>
                <span className="ds-chart-ylabel">{Math.round(max * g).toLocaleString()}</span>
              </div>
            ))}
            <div className="ds-chart-bars">
              {data.map((point) => (
                <div key={point.date} className="ds-chart-col group" title={`${point.date} · ${point.human} human · ${point.agent} agent`}>
                  <div className="ds-chart-stack">
                    <div
                      className="ds-chart-seg"
                      style={{ background: 'var(--ds-series-2)', height: `${(point.agent / max) * 100}%`, minHeight: point.agent ? 2 : 0 }}
                    />
                    <div
                      className="ds-chart-seg ds-chart-seg--base"
                      style={{ background: 'var(--ds-series-1)', height: `${(point.human / max) * 100}%`, minHeight: point.human ? 2 : 0 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* X axis */}
          <div className="ds-chart-xaxis">
            {data.map((point, i) => (
              <div key={point.date} className="ds-chart-xtick">
                {i % tickEvery === 0 ? point.date.slice(5) : ''}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TopPagesTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: Array<{ path: string; views: number }>
  emptyLabel: string
}) {
  const max = Math.max(...rows.map((r) => r.views), 1)
  return (
    <div className="ds-panel">
      <div className="ds-panel-head">
        <div className="ds-panel-title">{title}</div>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.path} className="flex items-center gap-3">
              <span
                className="min-w-0 flex-1 truncate"
                title={row.path}
                style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-secondary)' }}
              >
                {row.path}
              </span>
              <span className="ds-bar-track" aria-hidden>
                <span className="ds-bar-fill" style={{ width: `${(row.views / max) * 100}%` }} />
              </span>
              <span
                className="w-12 text-right tabular-nums"
                style={{ fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-fw-semibold)', color: 'var(--ds-text-primary)' }}
              >
                {row.views.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ListPanel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-panel">
      <div className="ds-panel-head">
        <div className="ds-panel-title">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function AnalyticsView() {
  const router = useRouter()
  const [range, setRange] = useState<AnalyticsRange>('30d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (selectedRange: AnalyticsRange) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/admin/analytics?range=${selectedRange}`)
        if (res.status === 401) {
          router.replace('/admin/login')
          return
        }
        if (!res.ok) throw new Error('Failed to load analytics')
        setData(await res.json())
      } catch {
        setError('Unable to load analytics data.')
      } finally {
        setLoading(false)
      }
    },
    [router],
  )

  useEffect(() => {
    void load(range)
  }, [range, load])

  const agentShare =
    data && data.totals.pageViews > 0 ? Math.round((data.totals.agentViews / data.totals.pageViews) * 100) : 0

  return (
    <div className="ds-rise">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="ds-eyebrow">Traffic &amp; engagement</div>
          <h1
            style={{
              fontFamily: 'var(--ds-font-heading)',
              fontSize: 'var(--ds-text-h2)',
              fontWeight: 'var(--ds-fw-bold)',
              letterSpacing: 'var(--ds-tracking-tight)',
              lineHeight: 1.1,
            }}
          >
            Audience
          </h1>
        </div>
        <div className="ds-segmented" role="tablist" aria-label="Date range">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={range === item.id}
              className="ds-segmented__item ds-focusable"
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="space-y-6">
          <div className="dash-grid dash-grid--4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="ds-stat-card">
                <div className="ds-skeleton" style={{ width: 90, height: 12 }} />
                <div className="ds-skeleton" style={{ width: 64, height: 30 }} />
                <div className="ds-skeleton" style={{ width: 72, height: 12 }} />
              </div>
            ))}
          </div>
          <div className="ds-panel">
            <div className="ds-skeleton" style={{ width: '100%', height: 224 }} />
          </div>
        </div>
      ) : error && !data ? (
        <div className="ds-panel">
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-danger)' }}>{error}</p>
        </div>
      ) : data ? (
        // Keep the current data on screen while a range switch refetches — just
        // dim it briefly instead of blanking to a skeleton (no janky blip).
        <div
          className="space-y-6"
          style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s var(--ds-ease-out, ease)' }}
          aria-busy={loading}
        >
          <div className="dash-grid dash-grid--4">
            <StatCard label="Total page views" value={data.totals.pageViews.toLocaleString()} />
            <StatCard
              label="Human traffic"
              value={data.totals.humanViews.toLocaleString()}
              hint={`${100 - agentShare}% of views`}
            />
            <StatCard
              label="Agent traffic"
              value={data.totals.agentViews.toLocaleString()}
              modifier="ds-stat-card--glow ds-stat-card--accent2"
              hint={
                <>
                  <span className="ds-chip ds-chip--accent">{agentShare}%</span> of views
                </>
              }
            />
            <StatCard
              label="Discovery hits"
              value={data.totals.discoveryHits.toLocaleString()}
              hint="llms.txt, ai.txt, docs-index"
            />
          </div>

          <div className="dash-grid dash-grid--2">
            <TrafficChart data={data.dailyTraffic} />
            <div className="ds-panel flex flex-col">
              <div className="ds-panel-head">
                <div>
                  <div className="ds-panel-title">Engagement</div>
                  <div className="ds-panel-sub">Feedback &amp; chat</div>
                </div>
              </div>
              <div className="flex flex-1 flex-col justify-center">
                <span
                  style={{
                    fontFamily: 'var(--ds-font-heading)',
                    fontSize: 'var(--ds-text-h1)',
                    fontWeight: 'var(--ds-fw-extrabold)',
                    letterSpacing: 'var(--ds-tracking-tighter)',
                    lineHeight: 1,
                  }}
                >
                  {(data.totals.feedbackYes + data.totals.feedbackNo).toLocaleString()}
                </span>
                <span className="mt-1.5" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
                  feedback signals collected
                </span>
                <div className="mt-5 flex flex-wrap gap-2">
                  <span className="ds-chip ds-chip--success">{data.totals.feedbackYes} helpful</span>
                  <span className="ds-chip ds-chip--warn">{data.totals.feedbackNo} not helpful</span>
                  <span className="ds-chip ds-chip--neutral">{data.totals.chatMessages} chat</span>
                </div>
              </div>
            </div>
          </div>

          <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <TopPagesTable title="Top pages — humans" rows={data.topPages.human} emptyLabel="No human traffic yet." />
            <TopPagesTable title="Top pages — agents" rows={data.topPages.agent} emptyLabel="No agent traffic yet." />
          </div>

          <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <ListPanel title="Agent detection signals">
              {data.agentSignals.length === 0 ? (
                <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>No agent requests recorded.</p>
              ) : (
                <div className="space-y-2.5">
                  {data.agentSignals.map((row) => (
                    <div key={row.signal} className="flex items-center justify-between">
                      <span className="ds-chip ds-chip--neutral" style={{ fontFamily: 'var(--ds-font-mono)' }}>
                        {row.signal}
                      </span>
                      <span className="tabular-nums" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-secondary)' }}>
                        {row.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ListPanel>

            <ListPanel title="Recent feedback">
              {data.recentFeedback.length === 0 ? (
                <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>No feedback submitted yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {data.recentFeedback.map((item) => (
                    <div key={`${item.ts}-${item.page}`} className="flex items-center justify-between gap-3">
                      <span
                        className="min-w-0 truncate"
                        title={item.page}
                        style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-secondary)' }}
                      >
                        {item.page}
                      </span>
                      <span className={cn('ds-chip', item.vote === 'yes' ? 'ds-chip--success' : 'ds-chip--warn')}>
                        {item.vote === 'yes' ? 'Helpful' : 'Not helpful'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ListPanel>
          </div>

          <div>
            <div className="mb-4">
              <div className="ds-eyebrow">Search</div>
              <h2 className="ds-section-title" style={{ marginBottom: 0 }}>What people look for</h2>
            </div>
            {data.search.totalSearches === 0 ? (
              <div className="ds-panel">
                <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>No searches recorded yet for this range.</p>
              </div>
            ) : (
              <div className="dash-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <ListPanel
                  title="Top search terms"
                  action={
                    <span className="ds-chip ds-chip--neutral">
                      {data.search.totalSearches.toLocaleString()} searches · {Math.round(data.search.clickThroughRate * 100)}% CTR
                    </span>
                  }
                >
                  <div className="space-y-3">
                    {data.search.topTerms.map((t) => {
                      const termMax = Math.max(...data.search.topTerms.map((x) => x.count), 1)
                      return (
                        <div key={t.term} className="flex items-center gap-3">
                          <span className="min-w-0 flex-1 truncate" title={t.term} style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-secondary)' }}>
                            {t.term}
                          </span>
                          <span className="ds-bar-track" aria-hidden>
                            <span className="ds-bar-fill" style={{ width: `${(t.count / termMax) * 100}%` }} />
                          </span>
                          <span className="w-10 text-right tabular-nums" style={{ fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-fw-semibold)' }}>
                            {t.count.toLocaleString()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </ListPanel>

                <ListPanel title="Content gaps — zero results">
                  {data.search.zeroResults.length === 0 ? (
                    <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
                      Every search found something.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.search.zeroResults.map((t) => (
                        <span key={t.term} className="ds-chip ds-chip--warn" title={`${t.count} searches, no results`}>
                          {t.term}
                          {t.count > 1 ? ` · ${t.count}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </ListPanel>
              </div>
            )}
          </div>

          {data.contentGaps && data.contentGaps.length > 0 ? (
            <div>
              <div className="mb-4">
                <div className="ds-eyebrow">Insights</div>
                <h2 className="ds-section-title" style={{ marginBottom: 0 }}>Content gaps</h2>
              </div>
              <div className="ds-panel">
                <div className="ds-panel-head">
                  <div className="ds-panel-title">What people want that the docs don&apos;t cover</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.contentGaps.map((g) => (
                    <span
                      key={`${g.source}-${g.term}`}
                      className="ds-chip ds-chip--warn"
                      title={`${g.count}× from ${g.source === 'chat' ? 'AI chat (unanswered)' : 'search (zero results)'}`}
                    >
                      {g.term}
                      <span style={{ opacity: 0.6, marginLeft: 4 }}>
                        {g.source === 'chat' ? '💬' : '🔍'}
                        {g.count > 1 ? ` ${g.count}` : ''}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="mt-3" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
                  From AI-chat questions the docs couldn&apos;t answer (💬) and searches with no results (🔍) — each a page worth writing.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
