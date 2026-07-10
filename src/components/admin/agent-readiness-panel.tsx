'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Check, GitPullRequest } from 'lucide-react'
import type { AgentReadinessReport, SubscoreResult } from '@/lib/agent-readiness/types'

type ReadinessResponse = AgentReadinessReport & {
  schema_version: string
  as_of: string
}

type DispatchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string; code?: string }

function SubscoreRow({
  sub,
  fixIndex,
  open,
  onToggle,
  dispatch,
  onSendPr,
}: {
  sub: SubscoreResult
  fixIndex: number | null
  open: boolean
  onToggle: () => void
  dispatch: DispatchState
  onSendPr: () => void
}) {
  const pct = Math.round(sub.score * 100)
  const hasOffenders = sub.offenders.length > 0
  const isSending = dispatch.status === 'loading'

  return (
    <>
      <tr className="ds-readiness-row">
        <td className="ds-readiness-check">
          <div className="ds-readiness-check-main">
            <span className="ds-readiness-check-label">{sub.label}</span>
            {fixIndex != null ? (
              <>
                <button
                  type="button"
                  onClick={onToggle}
                  className="ds-readiness-fix-badge ds-focusable"
                  aria-expanded={open}
                >
                  Fix {fixIndex}
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--secondary ds-btn--sm ds-focusable ds-readiness-send-pr"
                  onClick={onSendPr}
                  disabled={isSending}
                >
                  <GitPullRequest className="h-3.5 w-3.5" aria-hidden />
                  {isSending ? 'Sending…' : 'Send PR'}
                </button>
              </>
            ) : null}
          </div>
          <p className="ds-readiness-check-detail">{sub.detail}</p>
          {dispatch.status === 'success' ? (
            <p className="ds-readiness-dispatch ds-readiness-dispatch--ok">{dispatch.message}</p>
          ) : null}
          {dispatch.status === 'error' ? (
            <p className="ds-readiness-dispatch ds-readiness-dispatch--err" role="alert">
              {dispatch.message}
              {dispatch.code === 'no_repo' ? (
                <>
                  {' '}
                  <Link href="/admin/settings" className="ds-readiness-dispatch-link">
                    Configure repository
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
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
  const [dispatches, setDispatches] = useState<Record<string, DispatchState>>({})

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

  async function sendPr(subscoreId: string) {
    setDispatches((prev) => ({ ...prev, [subscoreId]: { status: 'loading' } }))
    try {
      const res = await fetch('/api/admin/agent-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscoreId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        message?: string
      }
      if (!res.ok) {
        setDispatches((prev) => ({
          ...prev,
          [subscoreId]: {
            status: 'error',
            message: data.error || 'Could not dispatch the docs agent.',
            code: data.code,
          },
        }))
        return
      }
      setDispatches((prev) => ({
        ...prev,
        [subscoreId]: {
          status: 'success',
          message: data.message || 'Docs agent dispatched. A fix PR will appear shortly.',
        },
      }))
    } catch {
      setDispatches((prev) => ({
        ...prev,
        [subscoreId]: {
          status: 'error',
          message: 'Network error — could not reach the docs agent.',
        },
      }))
    }
  }

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
                    dispatch={dispatches[sub.id] ?? { status: 'idle' }}
                    onSendPr={() => void sendPr(sub.id)}
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
