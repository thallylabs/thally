'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { AgentReadinessReport, SubscoreResult } from '@/lib/agent-readiness/types'

type ReadinessResponse = AgentReadinessReport & {
  schema_version: string
  as_of: string
}

function toneForScore(score: number): 'success' | 'warn' | 'danger' {
  if (score >= 0.9) return 'success'
  if (score >= 0.6) return 'warn'
  return 'danger'
}

function SubscoreRow({ sub }: { sub: SubscoreResult }) {
  const [open, setOpen] = useState(false)
  const pct = Math.round(sub.score * 100)
  const tone = toneForScore(sub.score)
  const hasOffenders = sub.offenders.length > 0

  return (
    <div className="border-t py-4 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--ds-border-subtle)' }}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p style={{ fontSize: 'var(--ds-text-body)', fontWeight: 'var(--ds-fw-medium)', color: 'var(--ds-text-primary)' }}>
            {sub.label}
          </p>
          <p className="mt-0.5 truncate" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
            {sub.detail}
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3">
          <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-faint)' }}>{Math.round(sub.weight * 100)}%</span>
          <span
            className="w-11 text-right tabular-nums"
            style={{ fontSize: 'var(--ds-text-body)', fontWeight: 'var(--ds-fw-bold)', letterSpacing: 'var(--ds-tracking-tight)', color: `var(--ds-${tone})` }}
          >
            {pct}%
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden" style={{ background: 'var(--ds-surface-active)', borderRadius: 'var(--ds-radius-full)' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 'var(--ds-radius-full)',
              background: `var(--ds-${tone})`,
              transition: 'width var(--ds-dur-slow) var(--ds-ease-out)',
            }}
          />
        </div>
        {hasOffenders ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ds-focusable shrink-0 rounded"
            style={{
              fontSize: 'var(--ds-text-caption)',
              fontWeight: 'var(--ds-fw-semibold)',
              color: open ? 'var(--ds-text-secondary)' : 'var(--ds-accent-mid)',
            }}
          >
            {open ? 'Hide' : `Fix ${sub.offenders.length}`}
          </button>
        ) : null}
      </div>

      {open && hasOffenders ? (
        <ul className="mt-3 space-y-1.5 p-3" style={{ background: 'var(--ds-surface-tint)', borderRadius: 'var(--ds-radius-lg)' }}>
          {sub.offenders.map((offender) => (
            <li key={offender.pageId} className="flex items-center justify-between gap-3">
              <a
                href={offender.href}
                target="_blank"
                rel="noreferrer"
                title={offender.href}
                className="min-w-0 truncate hover:underline"
                style={{ fontFamily: 'var(--ds-font-mono)', fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-secondary)' }}
              >
                {offender.href}
              </a>
              <span className="shrink-0" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
                {offender.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function AgentReadinessPanel() {
  const [report, setReport] = useState<ReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/agent-readiness')
        if (!res.ok) throw new Error('failed')
        const data = (await res.json()) as ReadinessResponse
        if (active) setReport(data)
      } catch {
        if (active) setError('Unable to load the Agent Readiness Score.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const tone = report ? toneForScore(report.score / 100) : 'success'

  return (
    <div className="ds-rise">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="ds-eyebrow">Agent readiness</div>
          <h1
            style={{
              fontFamily: 'var(--ds-font-heading)',
              fontSize: 'var(--ds-text-h2)',
              fontWeight: 'var(--ds-fw-bold)',
              letterSpacing: 'var(--ds-tracking-tight)',
              lineHeight: 1.1,
            }}
          >
            Readiness report
          </h1>
          <p className="mt-1.5 max-w-[56ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            How well your docs serve AI agents — structured data, metadata, discovery, and machine-readability.
          </p>
        </div>
        <a href="/api/agent-readiness" target="_blank" rel="noreferrer" className="ds-btn ds-btn--secondary ds-btn--sm ds-focusable">
          View JSON <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </header>

      <section className="ds-panel">
        {loading ? (
          <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
            <div className="ds-skeleton-ring" style={{ width: 132, height: 132 }} />
            <div className="min-w-0 flex-1 space-y-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="ds-skeleton" style={{ width: '40%', height: 14 }} />
                  <div className="ds-skeleton" style={{ width: '100%', height: 6 }} />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-danger)' }}>{error}</p>
        ) : report ? (
          <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
            <div className="flex shrink-0 flex-row items-center gap-5 lg:w-44 lg:flex-col lg:justify-center lg:gap-4">
              <div
                className={`ds-ring ds-ring--${tone}`}
                style={{ '--ds-ring-value': report.score, '--ds-ring-size': '132px', '--ds-ring-stroke': '7' } as CSSProperties}
              >
                <svg className="ds-ring__svg" viewBox="0 0 100 100">
                  <circle className="ds-ring__track" cx="50" cy="50" r="45" pathLength={100} />
                  <circle className="ds-ring__fill" cx="50" cy="50" r="45" pathLength={100} />
                </svg>
                <span className="ds-ring__label flex flex-col items-center">
                  <span style={{ fontSize: '2rem', lineHeight: 1, letterSpacing: 'var(--ds-tracking-tighter)', fontWeight: 'var(--ds-fw-extrabold)' }}>
                    {report.score}
                  </span>
                  <span className="mt-1" style={{ fontSize: 'var(--ds-text-caption)', fontWeight: 'var(--ds-fw-semibold)', color: `var(--ds-${tone})` }}>
                    Grade {report.grade}
                  </span>
                </span>
              </div>
              <p style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-faint)' }} className="lg:text-center">
                across {report.totalPages} page{report.totalPages === 1 ? '' : 's'}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              {report.subscores.map((sub) => (
                <SubscoreRow key={sub.id} sub={sub} />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
