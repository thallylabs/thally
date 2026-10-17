'use client'

/**
 * GitLab connection for Thally Track. When the cloud tier implements
 * provider-keyed connections, owners store a project or group access token
 * here; otherwise the panel explains the environment-variable setup, which
 * works for self-hosted Track without any cloud service.
 */

import { useEffect, useState } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import { GitlabIcon } from '@/components/layout/gitlab-icon'
import type { ScmConnectionStatus } from '@/lib/cloud-bridge/types'

type PanelState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; status: ScmConnectionStatus }

const ENDPOINT = '/api/admin/scm/gitlab'

/** Render GitLab connection status, a connect form, or setup instructions. */
export function GitlabConnectPanel({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(ENDPOINT)
      .then(async (response) => {
        if (!response.ok) return setState({ kind: 'unavailable' })
        setState({ kind: 'ready', status: (await response.json()) as ScmConnectionStatus })
      })
      .catch(() => setState({ kind: 'unavailable' }))
  }, [])

  async function connect() {
    if (!canEdit || isBusy || !token.trim()) return
    setIsBusy(true)
    setError(null)
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: host.trim() || undefined, token: token.trim() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : `Could not connect (HTTP ${response.status}).`)
        return
      }
      setToken('')
      setState({ kind: 'ready', status: body as ScmConnectionStatus })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setIsBusy(false)
    }
  }

  async function disconnect() {
    if (!canEdit || isBusy || state.kind !== 'ready') return
    if (!window.confirm('Disconnect GitLab? Thally Track will fall back to THALLY_GITLAB_TOKEN (if set).')) return
    setIsBusy(true)
    setError(null)
    try {
      const response = await fetch(ENDPOINT, { method: 'DELETE' })
      if (response.ok) {
        setState({
          kind: 'ready',
          status: { ...state.status, connected: false, installed: false, label: null, manageUrl: null },
        })
      } else {
        setError(`Could not disconnect (HTTP ${response.status}).`)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="ds-settings-row ds-settings-row--top">
      <div className="min-w-0">
        <div className="ds-setting-row-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <GitlabIcon className="h-3.5 w-3.5" /> GitLab (Thally Track)
        </div>
        <div className="ds-setting-row-desc">
          Watch gitlab.com or self-hosted GitLab projects. Use a project or group access token with{' '}
          <code className="font-mono">read_api</code>, and add a project webhook for merge request events with your{' '}
          <code className="font-mono">THALLY_TRACK_WEBHOOK_SECRET</code> as the secret token.
        </div>
      </div>
      <div className="ds-settings-control">
        {state.kind === 'loading' ? null : state.kind === 'unavailable' ? (
          <span className="ds-settings-caption">
            Set <code className="font-mono">THALLY_GITLAB_TOKEN</code> on this site. For a self-hosted instance, also set{' '}
            <code className="font-mono">THALLY_GIT_HOSTS=your.host=gitlab</code>. Run{' '}
            <code className="font-mono">thally track setup</code> for the full steps.
          </span>
        ) : state.status.connected ? (
          <>
            <div className="ds-settings-field" style={{ gap: 8 }}>
              <span className="ds-chip ds-chip--neutral ds-chip--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {state.status.installed ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                {state.status.label ?? 'Connected'}
              </span>
              {state.status.manageUrl && /^https:\/\//i.test(state.status.manageUrl) ? (
                <a
                  href={state.status.manageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ds-linkbtn ds-focusable"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  Manage token
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
              {canEdit ? (
                <button type="button" className="ds-linkbtn ds-focusable" onClick={disconnect} disabled={isBusy}>
                  Disconnect
                </button>
              ) : null}
            </div>
            <span className="ds-settings-caption">
              {state.status.host ? `Connected to ${state.status.host}.` : 'Connected to gitlab.com.'}
            </span>
          </>
        ) : (
          <>
            <div className="ds-settings-addrow">
              <input
                className="ds-input ds-focusable"
                style={{ width: 150 }}
                value={host}
                disabled={!canEdit || isBusy}
                placeholder="gitlab.com"
                aria-label="GitLab host"
                onChange={(event) => setHost(event.target.value)}
              />
              <input
                className="ds-input ds-focusable"
                style={{ width: 180 }}
                type="password"
                autoComplete="off"
                value={token}
                disabled={!canEdit || isBusy}
                placeholder="Access token"
                aria-label="GitLab access token"
                onChange={(event) => setToken(event.target.value)}
              />
              <button type="button" className="ds-btn ds-btn--primary ds-btn--sm ds-focusable" onClick={connect} disabled={!canEdit || isBusy || !token.trim()}>
                Connect GitLab
              </button>
            </div>
            {error ? <span className="ds-settings-caption" role="alert">{error}</span> : null}
          </>
        )}
      </div>
    </div>
  )
}
