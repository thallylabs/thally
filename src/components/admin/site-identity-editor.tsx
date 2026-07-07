'use client'

import { useEffect, useState } from 'react'

export function SiteIdentityEditor({
  canEdit,
  defaultName,
  defaultDescription,
  defaultRepoUrl,
}: {
  canEdit: boolean
  defaultName: string
  defaultDescription: string
  defaultRepoUrl: string
}) {
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState(defaultDescription)
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s) return
        if (typeof s.siteName === 'string') setName(s.siteName)
        if (typeof s.siteDescription === 'string') setDescription(s.siteDescription)
        if (typeof s.siteRepoUrl === 'string') setRepoUrl(s.siteRepoUrl)
      })
      .catch(() => {})
  }, [])

  async function save(patch: Record<string, unknown>) {
    if (!canEdit) return
    setError(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 1400)
      } else {
        setError((await res.json().catch(() => ({}))).error ?? 'Save failed')
      }
    } catch {
      setError('Save failed')
    }
  }

  const inputStyle: React.CSSProperties = { width: 'min(440px, 100%)', maxWidth: '100%' }

  return (
    <div className="ds-setting-list">
      <div className="ds-setting-row">
        <div className="min-w-0">
          <div className="ds-setting-row-label">Name</div>
          <div className="ds-setting-row-desc">Shown in the header, browser tab, and social cards.</div>
        </div>
        <input
          className="ds-input ds-focusable"
          style={inputStyle}
          value={name}
          disabled={!canEdit}
          placeholder="Your Docs"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== defaultName && save({ siteName: name })}
        />
      </div>

      <div className="ds-setting-row" style={{ alignItems: 'flex-start' }}>
        <div className="min-w-0">
          <div className="ds-setting-row-label">Description</div>
          <div className="ds-setting-row-desc">Used for SEO meta + social previews.</div>
        </div>
        <textarea
          className="ds-input ds-focusable"
          rows={3}
          style={{ ...inputStyle, height: 'auto', minHeight: 84, padding: '10px 12px', lineHeight: 1.5, resize: 'vertical' }}
          value={description}
          disabled={!canEdit}
          placeholder="One line about your product's docs."
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => save({ siteDescription: description })}
        />
      </div>

      <div className="ds-setting-row">
        <div className="min-w-0">
          <div className="ds-setting-row-label">Repository</div>
          <div className="ds-setting-row-desc">GitHub repo for the docs agent + tasks queue.</div>
        </div>
        <input
          className="ds-input ds-focusable"
          style={inputStyle}
          value={repoUrl}
          disabled={!canEdit}
          placeholder="https://github.com/org/repo"
          onChange={(e) => setRepoUrl(e.target.value)}
          onBlur={() => save({ siteRepoUrl: repoUrl })}
        />
      </div>

      {error ? (
        <p style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-danger)', padding: '0 var(--ds-space-20) var(--ds-space-12)' }}>{error}</p>
      ) : saved ? (
        <p style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-success)', padding: '0 var(--ds-space-20) var(--ds-space-12)' }}>Saved ✓</p>
      ) : null}
    </div>
  )
}
