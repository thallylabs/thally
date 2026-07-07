'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type { AgentReadinessReport } from '@/lib/agent-readiness/types'
import type { AnalyticsSummary } from '@/lib/analytics/types'

function ringTone(score: number): 'success' | 'warn' | 'danger' {
  if (score >= 80) return 'success'
  if (score >= 60) return 'warn'
  return 'danger'
}

const AGENT_ENDPOINTS = [
  { href: '/llms.txt', label: 'llms.txt', desc: 'Sitemap for language models' },
  { href: '/ai.txt', label: 'ai.txt', desc: 'Crawler + usage policy' },
  { href: '/api/docs-index', label: 'docs-index', desc: 'Full content index as JSON' },
  { href: '/api/agent-readiness', label: 'agent-readiness', desc: 'Live readiness report' },
]

export function HomeView({ siteName }: { siteName: string }) {
  const [readiness, setReadiness] = useState<AgentReadinessReport | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [r, a] = await Promise.allSettled([
        fetch('/api/agent-readiness').then((res) => (res.ok ? res.json() : null)),
        fetch('/api/admin/analytics?range=30d').then((res) => (res.ok ? res.json() : null)),
      ])
      if (!active) return
      if (r.status === 'fulfilled') setReadiness(r.value)
      if (a.status === 'fulfilled') setAnalytics(a.value)
    })()
    return () => {
      active = false
    }
  }, [])

  const tone = readiness ? ringTone(readiness.score) : 'success'
  const agentShare =
    analytics && analytics.totals.pageViews > 0
      ? Math.round((analytics.totals.agentViews / analytics.totals.pageViews) * 100)
      : 0

  const kpis = [
    { label: 'Page views', value: analytics?.totals.pageViews, hint: 'Last 30 days' },
    { label: 'Human traffic', value: analytics?.totals.humanViews, hint: `${100 - agentShare}% of views` },
    { label: 'Agent traffic', value: analytics?.totals.agentViews, hint: `${agentShare}% of views`, accent: true },
    { label: 'Discovery hits', value: analytics?.totals.discoveryHits, hint: 'Machine endpoints' },
  ]

  return (
    <div className="ds-rise space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1
            style={{
              fontFamily: 'var(--ds-font-heading)',
              fontSize: 'var(--ds-text-h2)',
              fontWeight: 'var(--ds-fw-bold)',
              letterSpacing: 'var(--ds-tracking-tight)',
              lineHeight: 1.1,
            }}
          >
            Overview
          </h1>
          <p className="mt-1.5" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            How {siteName} is serving humans and AI agents, at a glance.
          </p>
        </div>
      </header>

      {/* KPI glance */}
      <div className="dash-grid dash-grid--4">
        {kpis.map((k) => (
          <div key={k.label} className={`ds-stat-card${k.accent ? ' ds-stat-card--glow ds-stat-card--accent2' : ''}`}>
            <span className="ds-stat-card-label">{k.label}</span>
            <span className="ds-stat-card-value">{k.value != null ? k.value.toLocaleString() : '—'}</span>
            <div className="ds-stat-card-footer">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Readiness + endpoints */}
      <div className="dash-grid dash-grid--2">
        <Link href="/admin/agent-readiness" className={`ds-panel ds-panel--interactive ds-focusable group block ds-ring--${tone}`}>
          <div className="ds-panel-head">
            <div>
              <div className="ds-eyebrow">Agent readiness</div>
              <div className="ds-panel-title" style={{ margin: 0 }}>
                How agent-ready are your docs?
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5"
              style={{ color: 'var(--ds-text-faint)' }}
            />
          </div>
          {readiness ? (
            <div className="flex items-center gap-6">
              <div
                className={`ds-ring ds-ring--${tone}`}
                style={{ '--ds-ring-value': readiness.score, '--ds-ring-size': '112px', '--ds-ring-stroke': '7' } as CSSProperties}
              >
                <svg className="ds-ring__svg" viewBox="0 0 100 100">
                  <circle className="ds-ring__track" cx="50" cy="50" r="45" pathLength={100} />
                  <circle className="ds-ring__fill" cx="50" cy="50" r="45" pathLength={100} />
                </svg>
                <span className="ds-ring__label" style={{ fontSize: 'var(--ds-text-h3)', fontWeight: 'var(--ds-fw-extrabold)' }}>
                  {readiness.score}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 'var(--ds-text-h4)', fontWeight: 'var(--ds-fw-bold)', color: `var(--ds-${tone})` }}>
                  Grade {readiness.grade}
                </div>
                <div className="mt-0.5" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
                  across {readiness.totalPages} page{readiness.totalPages === 1 ? '' : 's'}
                </div>
                <div
                  className="mt-3 inline-flex items-center gap-1"
                  style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-accent-mid)', fontWeight: 'var(--ds-fw-semibold)' }}
                >
                  View breakdown <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="ds-skeleton-ring" />
              <div className="space-y-2">
                <div className="ds-skeleton" style={{ width: 96, height: 20 }} />
                <div className="ds-skeleton" style={{ width: 128, height: 14 }} />
              </div>
            </div>
          )}
        </Link>

        <div className="ds-panel">
          <div className="ds-panel-head">
            <div>
              <div className="ds-eyebrow">Machine-readable surface</div>
              <div className="ds-panel-title" style={{ margin: 0 }}>
                Agent endpoints
              </div>
            </div>
          </div>
          <p className="-mt-2 mb-4" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            Every page is served to humans as HTML and to agents as structured data from the same URL.
          </p>
          <div className="ds-endpoint-list">
            {AGENT_ENDPOINTS.map((endpoint) => (
              <a
                key={endpoint.href}
                href={endpoint.href}
                target="_blank"
                rel="noreferrer"
                className="ds-endpoint-row ds-focusable group"
              >
                <span className="min-w-0">
                  <span className="ds-endpoint-name" style={{ fontFamily: 'var(--ds-font-mono)' }}>
                    {endpoint.href}
                  </span>
                  <span className="ds-endpoint-desc block truncate">{endpoint.desc}</span>
                </span>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  style={{ color: 'var(--ds-text-faint)' }}
                />
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
