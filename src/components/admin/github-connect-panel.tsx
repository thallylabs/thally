'use client'

import { useEffect, useState } from 'react'
import { Check, Github, ExternalLink } from 'lucide-react'

interface AppStatus {
  connected: boolean
  installed: boolean
  slug: string | null
  htmlUrl: string | null
  installationId: string | null
}

interface ManifestStart {
  manifest: Record<string, unknown>
  state: string
  githubUrl: string
}

/** Map the ?github_app=… callback result to a human message. */
const RESULT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'GitHub App connected and installed — Thally Track can now watch your selected repos.', ok: true },
  bad_state: { text: 'The connect link expired or was tampered with. Start again.', ok: false },
  exchange_failed: { text: 'GitHub could not complete the app creation. Start again.', ok: false },
  no_auth_secret: { text: 'THALLY_AUTH_SECRET is required to store the app credentials securely.', ok: false },
  missing_code: { text: 'GitHub returned no app code. Start again.', ok: false },
  not_connected: { text: 'No app to attach the installation to — start the connect flow again.', ok: false },
  forbidden: { text: 'Owner access is required to connect GitHub.', ok: false },
}

/**
 * "Connect GitHub" — drives the App Manifest flow. The Connect button POSTs the
 * manifest to GitHub (their documented create UX), which walks the owner through
 * creating + installing their OWN app; GitHub redirects back to our callback,
 * which captures the credentials. This component only kicks it off and shows status.
 */
export function GithubConnectPanel({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [org, setOrg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/admin/github-app')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus(s))
      .catch(() => {})
    // Surface the callback result, then strip the param from the URL.
    const params = new URLSearchParams(window.location.search)
    const code = params.get('github_app')
    if (code && RESULT_MESSAGES[code]) {
      setResult(RESULT_MESSAGES[code])
      params.delete('github_app')
      const qs = params.toString()
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
  }, [])

  async function connect() {
    if (!canEdit || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/github-app', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org: org.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `Could not start (HTTP ${res.status}).`)
        setBusy(false)
        return
      }
      const start = (await res.json()) as ManifestStart
      // GitHub's manifest-create UX: POST a form to /settings/apps/new with the
      // manifest as a hidden field. This navigates away to GitHub.
      const form = document.createElement('form')
      form.method = 'post'
      form.action = `${start.githubUrl}?state=${encodeURIComponent(start.state)}`
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'manifest'
      input.value = JSON.stringify(start.manifest)
      form.appendChild(input)
      document.body.appendChild(form)
      form.submit()
    } catch {
      setError('Could not reach the server.')
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!canEdit || busy) return
    if (!window.confirm('Disconnect the GitHub App? Thally Track will fall back to the env token (if any).')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/github-app', { method: 'DELETE' })
      if (res.ok) {
        setStatus({ connected: false, installed: false, slug: null, htmlUrl: null, installationId: null })
        setResult(null)
      } else {
        setError(`Could not disconnect (HTTP ${res.status}).`)
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ds-settings-row ds-settings-row--top">
      <div className="min-w-0">
        <div className="ds-setting-row-label">GitHub App (Thally Track)</div>
        <div className="ds-setting-row-desc">
          The Netlify/Vercel-style access path: create + install your own Thally app in a couple of clicks, then pick which
          repos Track watches. Grants org-wide access to selected private repos — no token to paste. Requires{' '}
          <code className="font-mono">THALLY_AUTH_SECRET</code>.
        </div>
      </div>
      <div className="ds-settings-control">
        {status?.connected ? (
          <>
            <div className="ds-settings-field" style={{ gap: 8 }}>
              <span className="ds-chip ds-chip--neutral ds-chip--sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {status.installed ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
                {status.slug ? `@${status.slug}` : 'Connected'}
              </span>
              {status.htmlUrl ? (
                <a
                  href={`${status.htmlUrl}/installations/new`}
                  target="_blank"
                  rel="noreferrer"
                  className="ds-linkbtn ds-focusable"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  {status.installed ? 'Manage repos' : 'Finish install'}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
              {canEdit ? (
                <button type="button" className="ds-linkbtn ds-focusable" onClick={disconnect} disabled={busy}>
                  Disconnect
                </button>
              ) : null}
            </div>
            <span className="ds-settings-caption">
              {status.installed ? 'Connected and installed.' : 'Created — finish installing it on your repos.'}
            </span>
          </>
        ) : (
          <>
            <div className="ds-settings-addrow">
              <input
                className="ds-input ds-focusable"
                style={{ width: 150 }}
                placeholder="org (optional)"
                value={org}
                disabled={!canEdit || busy}
                onChange={(e) => setOrg(e.target.value)}
              />
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-btn--sm ds-focusable"
                onClick={connect}
                disabled={!canEdit || busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: canEdit && !busy ? 1 : 0.55 }}
              >
                <Github className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Starting…' : 'Connect GitHub'}
              </button>
            </div>
            <span className="ds-settings-caption">
              Leave org blank for a personal-account app. You&apos;ll create it on GitHub, then choose repos.
            </span>
          </>
        )}
        {error ? (
          <span className="ds-settings-caption" style={{ color: 'var(--ds-danger)' }}>
            {error}
          </span>
        ) : result ? (
          <span className="ds-settings-caption" style={{ color: result.ok ? 'var(--ds-success)' : 'var(--ds-danger)' }}>
            {result.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}
