'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { AgentReadinessReport, SubscoreResult } from '@/lib/agent-readiness/types'

type ReadinessResponse = AgentReadinessReport & {
  schema_version: string
  as_of: string
}

function SubscoreRow({
  sub,
  fixIndex,
  open,
  onToggle,
}: {
  sub: SubscoreResult
  fixIndex: number | null
  open: boolean
  onToggle: () => void
}) {
  const pct = Math.round(sub.score * 100)
  const hasOffenders = sub.offenders.length > 0

  return (
    <>
      <tr className="ds-readiness-row">
        <td className="ds-readiness-check">
          <div className="ds-readiness-check-main">
            <span className="ds-readiness-check-label">{sub.label}</span>
            {fixIndex != null ? (
              <button
                type="button"
                onClick={onToggle}
                className="ds-readiness-fix-badge ds-focusable"
                aria-expanded={open}
              >
                Fix {fixIndex}
              </button>
            ) : null}
          </div>
          <p className="ds-readiness-check-detail">{sub.detail}</p>
        </td>
        <td className="ds-readiness-coverage">
          <div className="ds-readiness-bar" aria-hidden>
            <div className="ds-readiness-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </td>
        <td className="ds-readiness-weight">{Math.round(sub.weight * 100)}%</td>
        <td className="ds-readiness-score">{pct}</td>
      </tr>
      {open && hasOffenders ? (
        <tr className="ds-readiness-offenders-row">
          <td colSpan={4}>
            <ul className="ds-readiness-offenders">
              {sub.offenders.map((offender) => (
                <li key={offender.pageId}>
                  <a href={offender.href} target="_blank" rel="noreferrer" title={offender.href}>
                    {offender.href}
                  </a>
                  <span>{offender.reason}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function AgentReadinessPanel() {
  const [report, setReport] = useState<ReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openFixId, setOpenFixId] = useState<string | null>(null)

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

  const fixMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!report) return map
    let n = 1
    for (const sub of report.subscores) {
      if (sub.offenders.length > 0) {
        map.set(sub.id, n)
        n += 1
      }
    }
    return map
  }, [report])

  const fixCount = fixMap.size

  return (
    <div className="ds-rise ds-readiness">
      <header className="ds-readiness-header">
        <div className="ds-eyebrow ds-readiness-eyebrow">Agent readiness</div>
        <h1 className="ds-readiness-title">Readiness report</h1>
        <p className="ds-readiness-desc">
          How well your docs serve AI agents — structured data, metadata, discovery, and machine-readability.
        </p>
      </header>

      {loading ? (
        <div className="ds-readiness-summary">
          <div className="ds-skeleton" style={{ width: 96, height: 64 }} />
          <div className="space-y-2">
            <div className="ds-skeleton" style={{ width: 88, height: 24 }} />
            <div className="ds-skeleton" style={{ width: 120, height: 14 }} />
          </div>
        </div>
      ) : error ? (
        <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-danger)' }}>{error}</p>
      ) : report ? (
        <>
          <div className="ds-readiness-summary">
            <div className="ds-readiness-summary-left">
              <span className="ds-readiness-hero-score">{report.score}</span>
              <div className="ds-readiness-summary-meta">
                <span className="ds-chip ds-chip--success ds-readiness-grade">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Grade {report.grade}
                </span>
                <span className="ds-readiness-pages">
                  across {report.totalPages} page{report.totalPages === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            {fixCount > 0 ? (
              <button
                type="button"
                className="ds-readiness-fixes-pill ds-focusable"
                onClick={() => {
                  const first = report.subscores.find((s) => fixMap.has(s.id))
                  if (first) setOpenFixId((id) => (id === first.id ? null : first.id))
                }}
              >
                <span className="ds-readiness-fixes-dot" aria-hidden />
                {fixCount} fix{fixCount === 1 ? '' : 'es'} available
              </button>
            ) : null}
          </div>

          <div className="ds-readiness-table-wrap">
            <table className="ds-readiness-table">
              <thead>
                <tr>
                  <th scope="col">Check</th>
                  <th scope="col" className="ds-readiness-coverage-head">
                    Coverage
                  </th>
                  <th scope="col" className="ds-num">
                    Weight
                  </th>
                  <th scope="col" className="ds-num">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.subscores.map((sub) => (
                  <SubscoreRow
                    key={sub.id}
                    sub={sub}
                    fixIndex={fixMap.get(sub.id) ?? null}
                    open={openFixId === sub.id}
                    onToggle={() => setOpenFixId((id) => (id === sub.id ? null : sub.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
