'use client'

import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { parseColorToHex, deriveDarkAccent } from '@thallylabs/core/theme'

type ThemeId = 'default' | 'maple' | 'sharp' | 'minimal'

// Preview-only radii (px). These are the mock's numbers for the on-page preview
// — NOT the live structural-theme tokens (those live in theme-vars.ts and are
// driven by the saved `brandTheme`). `flat` drops the preview's shadows.
const THEMES: Array<{ id: ThemeId; name: string; desc: string; radius: number; controlRadius: number; flat: boolean }> = [
  { id: 'default', name: 'Default', desc: 'Balanced, rounded', radius: 12, controlRadius: 9999, flat: false },
  { id: 'maple', name: 'Maple', desc: 'Soft, generous curves', radius: 20, controlRadius: 9999, flat: false },
  { id: 'sharp', name: 'Sharp', desc: 'Crisp, near-square', radius: 4, controlRadius: 3, flat: false },
  { id: 'minimal', name: 'Minimal', desc: 'Understated, flat', radius: 10, controlRadius: 0, flat: true },
]

// Curated accent swatches. Applying one sets the light accent; the dark variant
// is derived (see deriveDarkAccent). Thally teal green leads.
const PRESETS = ['#007852', '#6ca52e', '#f97316', '#6366f1', '#334155', '#0ea5e9']

const MAX_ASSET_KB = 150

function DropTarget({
  kind,
  mode,
  shape,
  hasAsset,
  version,
  canEdit,
  onChange,
}: {
  kind: 'logo' | 'favicon'
  mode: 'light' | 'dark'
  shape: 'wide' | 'square'
  hasAsset: boolean
  version: number
  canEdit: boolean
  onChange: () => void
}) {
  // Dark variants save under their own API field and preview on an ink chip
  // (dark-mode artwork is usually light-colored — invisible on white).
  const field = mode === 'dark' ? (kind === 'logo' ? 'logoDark' : 'faviconDark') : kind
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError('PNG, JPEG or WebP only')
    if (file.size > MAX_ASSET_KB * 1024) return setError(`Max ${MAX_ASSET_KB}KB`)
    const dataUri = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: dataUri }),
      })
      if (res.ok) onChange()
      else setError((await res.json().catch(() => ({}))).error ?? 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: null }),
      })
      onChange()
    } finally {
      setBusy(false)
    }
  }

  const wide = shape === 'wide'
  const size = wide ? { width: 170, height: 80 } : { width: 88, height: 88 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <div
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onClick={() => canEdit && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (canEdit && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        // onDragOver MUST preventDefault or onDrop never fires.
        onDragOver={(e) => {
          if (!canEdit) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!canEdit) return
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void handleFile(f)
        }}
        className={canEdit ? 'ds-focusable' : undefined}
        style={{
          ...size,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: 8,
          textAlign: 'center',
          borderRadius: 12,
          border: `1.5px dashed ${dragOver ? 'var(--ds-accent-mid)' : 'var(--ds-border)'}`,
          background: dragOver ? 'var(--ds-surface-tint)' : 'transparent',
          cursor: canEdit ? 'pointer' : 'default',
          transition: 'border-color 120ms, background 120ms',
        }}
      >
        {hasAsset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/brand/${kind}?mode=${mode}&v=${version}`}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', borderRadius: 6, background: mode === 'dark' ? '#002b28' : '#fff', padding: 3 }}
          />
        ) : (
          <>
            <span style={{ fontSize: 'var(--ds-text-sm)', fontWeight: 'var(--ds-fw-semibold)' }}>
              {busy ? 'Uploading…' : wide ? 'Drop logo' : 'Icon'}
            </span>
            <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
              or <span style={{ textDecoration: 'underline' }}>browse files</span>
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
      {hasAsset && canEdit ? (
        <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm ds-focusable" onClick={() => void clear()}>
          Remove
        </button>
      ) : null}
      {error ? <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-danger)' }}>{error}</span> : null}
    </div>
  )
}

export function BrandingView({
  currentTheme,
  currentAccentLight,
  currentAccentDark,
  repoUrl,
  canEdit,
}: {
  currentTheme: ThemeId
  currentAccentLight: string
  currentAccentDark: string
  repoUrl: string
  canEdit: boolean
}) {
  void repoUrl
  const [theme, setTheme] = useState<ThemeId>(currentTheme)
  const [accentLight, setAccentLight] = useState(currentAccentLight)
  const [accentDark, setAccentDark] = useState(currentAccentDark)
  const [customInput, setCustomInput] = useState(currentAccentLight)
  const [accentError, setAccentError] = useState<string | null>(null)
  // Persisted baseline (F1, or the build props) — diff against it for `dirty`.
  const [savedTheme, setSavedTheme] = useState<ThemeId>(currentTheme)
  const [savedLight, setSavedLight] = useState(currentAccentLight)
  const [savedDark, setSavedDark] = useState(currentAccentDark)
  const [assets, setAssets] = useState({ hasLogo: false, hasFavicon: false, hasLogoDark: false, hasFaviconDark: false })
  const [assetVersion, setAssetVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refreshAssets() {
    setAssetVersion((v) => v + 1)
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s) return
        setAssets({
          hasLogo: Boolean(s.hasLogo),
          hasFavicon: Boolean(s.hasFavicon),
          hasLogoDark: Boolean(s.hasLogoDark),
          hasFaviconDark: Boolean(s.hasFaviconDark),
        })
        const t = (s.brandTheme as ThemeId) || currentTheme
        const l = s.brandAccent?.light || currentAccentLight
        const d = s.brandAccent?.dark || currentAccentDark
        setTheme(t)
        setSavedTheme(t)
        setAccentLight(l)
        setSavedLight(l)
        setCustomInput(l)
        setAccentDark(d)
        setSavedDark(d)
      })
      .catch(() => {})
  }
  useEffect(() => {
    refreshAssets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dirty = theme !== savedTheme || accentLight !== savedLight || accentDark !== savedDark
  const overridden = theme !== currentTheme || accentLight !== currentAccentLight || accentDark !== currentAccentDark

  // Apply a hex/rgb value: normalize → set light + derive dark. Both must be
  // strict #rrggbb or the API silently drops the accent, so we parse first.
  function applyAccent(raw: string) {
    const hex = parseColorToHex(raw)
    if (!hex) {
      setAccentError('Enter a hex (#16a34a) or rgb(…) color')
      return
    }
    setAccentError(null)
    setAccentLight(hex)
    setAccentDark(deriveDarkAccent(hex))
    setCustomInput(hex)
  }

  async function saveBranding() {
    if (!canEdit || !dirty) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brandTheme: theme, brandAccent: { light: accentLight, dark: accentDark } }),
      })
      if (res.ok) {
        setSavedTheme(theme)
        setSavedLight(accentLight)
        setSavedDark(accentDark)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const b = await res.json().catch(() => ({}))
        const hint = res.status === 401 || res.status === 403 ? ' — you need Owner access' : ''
        setError(b.error ?? `Save failed (HTTP ${res.status}${hint})`)
      }
    } catch {
      setError('Save failed — could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  function resetBranding() {
    setTheme(currentTheme)
    setAccentLight(currentAccentLight)
    setAccentDark(currentAccentDark)
    setCustomInput(currentAccentLight)
    setAccentError(null)
  }

  // Deferred so dragging/typing doesn't refetch the OG image on every keystroke.
  const deferredAccent = useDeferredValue(accentDark)
  const ogSrc = `/api/og?title=${encodeURIComponent('Overview')}&group=${encodeURIComponent('Introduction')}&description=${encodeURIComponent('Your page previews, styled from your brand.')}&accent=${encodeURIComponent(deferredAccent)}`

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0]
  const radius = active.radius
  const controlRadius = active.controlRadius
  const cardShadow = active.flat ? 'none' : '0 1px 2px rgba(15,23,42,0.06), 0 8px 24px -12px rgba(15,23,42,0.12)'

  const GAP = 22

  return (
    <div className="ds-rise">
      <header className="mb-8">
        <div className="ds-eyebrow">Appearance</div>
        <h1 style={{ fontFamily: 'var(--ds-font-heading)', fontSize: 'var(--ds-text-h2)', fontWeight: 'var(--ds-fw-bold)', lineHeight: 1.1 }}>
          Branding
        </h1>
        <p className="mt-1.5 max-w-[52ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          Pick your theme, brand color, logo and favicon, then Save. Applies to the live docs site — no merge or rebuild.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_380px]" style={{ gap: GAP }}>
        {/* Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
          {/* Structural theme */}
          <section className="ds-panel">
            <div className="ds-panel-head">
              <div>
                <div className="ds-panel-title">Structural theme</div>
                <div style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)', marginTop: 2 }}>
                  The radius and density applied across your docs.
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              {THEMES.map((t) => {
                const on = t.id === theme
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    disabled={!canEdit}
                    className="ds-focusable"
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 'var(--ds-radius-lg)',
                      border: `1.5px solid ${on ? 'var(--ds-accent-mid)' : 'var(--ds-border)'}`,
                      background: on ? 'var(--ds-surface-tint)' : 'transparent',
                      cursor: canEdit ? 'pointer' : 'default',
                    }}
                  >
                    <div className="flex items-center gap-1.5" style={{ fontWeight: 'var(--ds-fw-semibold)', fontSize: 'var(--ds-text-sm)' }}>
                      {t.name}
                      {on ? <Check className="h-3.5 w-3.5" style={{ color: 'var(--ds-accent-mid)' }} /> : null}
                    </div>
                    <div style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)', marginTop: 2 }}>{t.desc}</div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Brand accent */}
          <section className="ds-panel">
            <div className="ds-panel-head">
              <div>
                <div className="ds-panel-title">Brand accent</div>
                <div style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)', marginTop: 2 }}>
                  Drives links, active states and highlights. Primary buttons stay ink (light) and flip to your dark accent.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {PRESETS.map((hex) => {
                const on = hex.toLowerCase() === accentLight.toLowerCase()
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Use ${hex}`}
                    disabled={!canEdit}
                    onClick={() => applyAccent(hex)}
                    className="ds-focusable"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      background: hex,
                      cursor: canEdit ? 'pointer' : 'default',
                      border: '2px solid transparent',
                      boxShadow: on ? '0 0 0 2px var(--ds-surface), 0 0 0 4px var(--ds-accent-mid)' : 'none',
                    }}
                  />
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/* Native color wheel — picking applies immediately (sets light, derives dark). */}
              <input
                type="color"
                aria-label="Pick a custom accent color"
                disabled={!canEdit}
                value={parseColorToHex(accentLight) ?? '#000000'}
                onChange={(e) => applyAccent(e.target.value)}
                className="ds-focusable"
                style={{ width: 44, height: 38, padding: 2, border: '1px solid var(--ds-border)', borderRadius: 10, background: 'transparent', cursor: canEdit ? 'pointer' : 'default' }}
              />
              <input
                className="ds-input ds-focusable font-mono"
                style={{ width: 200 }}
                placeholder="#16a34a or rgb(22,163,74)"
                disabled={!canEdit}
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyAccent(customInput)
                  }
                }}
              />
              <button
                type="button"
                className="ds-btn ds-btn--primary ds-focusable"
                disabled={!canEdit}
                onClick={() => applyAccent(customInput)}
              >
                Apply
              </button>
            </div>
            {accentError ? (
              <p className="mt-2" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-danger)' }}>{accentError}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-8">
              {/* Each mode swatch is itself a picker: Light re-derives the dark
                  variant (same as Apply); Dark fine-tunes dark mode alone. */}
              {([
                ['Light', accentLight, (hex: string) => applyAccent(hex)],
                ['Dark', accentDark, (hex: string) => setAccentDark(hex)],
              ] as const).map(([label, hex, onPick]) => (
                <label key={label} className="flex items-center gap-2.5" style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                  <input
                    type="color"
                    aria-label={`Adjust ${label.toLowerCase()}-mode accent`}
                    disabled={!canEdit}
                    value={parseColorToHex(hex) ?? '#000000'}
                    onChange={(e) => onPick(e.target.value)}
                    className="ds-focusable"
                    style={{ width: 40, height: 40, padding: 2, border: '1px solid var(--ds-border)', borderRadius: 10, background: 'transparent' }}
                  />
                  <span>
                    <span className="ds-rail-label block">{label}</span>
                    <span className="font-mono" style={{ fontSize: 'var(--ds-text-caption)' }}>{hex}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Logo & favicon */}
          <section className="ds-panel">
            <div className="ds-panel-head"><div className="ds-panel-title">Logo &amp; favicon</div></div>
            <div>
              <div className="ds-setting-row" style={{ alignItems: 'flex-start' }}>
                <div className="min-w-0">
                  <div className="ds-setting-row-label">Logo</div>
                  <div className="ds-setting-row-desc">
                    Header + social cards. PNG/JPEG/WebP, ≤150KB. Dark mode falls back to the light logo when empty.
                  </div>
                </div>
                <div className="flex flex-wrap justify-end" style={{ gap: 14 }}>
                  {(['light', 'dark'] as const).map((mode) => (
                    <div key={mode} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      <span className="ds-rail-label">{mode === 'light' ? 'Light' : 'Dark'}</span>
                      <DropTarget
                        kind="logo"
                        mode={mode}
                        shape="wide"
                        hasAsset={mode === 'light' ? assets.hasLogo : assets.hasLogoDark}
                        version={assetVersion}
                        canEdit={canEdit}
                        onChange={refreshAssets}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ds-setting-row" style={{ alignItems: 'flex-start', borderTop: '1px solid var(--ds-border)', marginTop: 4, paddingTop: 20 }}>
                <div className="min-w-0">
                  <div className="ds-setting-row-label">Favicon</div>
                  <div className="ds-setting-row-desc">
                    Browser-tab icon; a square PNG works best. The dark icon shows on OS dark scheme.
                  </div>
                </div>
                <div className="flex flex-wrap justify-end" style={{ gap: 14 }}>
                  {(['light', 'dark'] as const).map((mode) => (
                    <div key={mode} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      <span className="ds-rail-label">{mode === 'light' ? 'Light' : 'Dark'}</span>
                      <DropTarget
                        kind="favicon"
                        mode={mode}
                        shape="square"
                        hasAsset={mode === 'light' ? assets.hasFavicon : assets.hasFaviconDark}
                        version={assetVersion}
                        canEdit={canEdit}
                        onChange={refreshAssets}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right rail: Preview + Social preview */}
        <div style={{ position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: GAP }}>
          <section className="ds-panel">
            <div className="ds-panel-head"><div className="ds-panel-title">Preview</div></div>
            <div style={{ border: '1px solid var(--ds-border)', borderRadius: radius, overflow: 'hidden', boxShadow: cardShadow }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ds-border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 24, height: 24, borderRadius: Math.min(radius, 12), background: accentLight, display: 'inline-block' }} />
                <strong style={{ fontSize: 'var(--ds-text-sm)' }}>Docs</strong>
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ width: 96, padding: 10, borderRight: '1px solid var(--ds-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, background: accentLight, color: '#fff', borderRadius: controlRadius, padding: '4px 9px', textAlign: 'center', fontWeight: 600 }}>Overview</span>
                  <span style={{ fontSize: 11, color: 'var(--ds-text-muted)', padding: '4px 9px' }}>Guides</span>
                  <span style={{ fontSize: 11, color: 'var(--ds-text-muted)', padding: '4px 9px' }}>API</span>
                </div>
                <div style={{ flex: 1, padding: 14 }}>
                  <div style={{ fontWeight: 'var(--ds-fw-bold)', fontSize: 'var(--ds-text-sm)' }}>Getting started</div>
                  <div style={{ fontSize: 11, color: 'var(--ds-text-muted)', marginTop: 4, lineHeight: 1.5 }}>A short paragraph of body copy showing your theme radius and accent.</div>
                  {/* Primary buttons are ink on the live site (accent stays on
                      links/active states), so the preview mirrors that. */}
                  <button type="button" style={{ marginTop: 10, background: 'var(--ds-primary)', color: 'var(--ds-primary-fg)', border: 'none', borderRadius: controlRadius, padding: '7px 13px', fontSize: 12, fontWeight: 600, boxShadow: active.flat ? 'none' : 'var(--ds-elev-1)' }}>
                    Primary action
                  </button>
                </div>
              </div>
            </div>
            <p className="mt-3" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
              Approximate preview. The exact theme applies site-wide as soon as you Save.
            </p>
          </section>

          <section className="ds-panel">
            <div className="ds-panel-head"><div className="ds-panel-title">Social preview (OG image)</div></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ogSrc}
              alt="Social share preview"
              width={1200}
              height={630}
              style={{ width: '100%', height: 'auto', borderRadius: 'var(--ds-radius-lg)', border: '1px solid var(--ds-border)' }}
            />
            <p className="mt-2" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
              Every page&apos;s link preview (Slack, X, iMessage…) is generated from your brand. This reflects the dark accent above.
            </p>
          </section>
        </div>
      </div>

      {/* Bottom action bar */}
      {canEdit ? (
        <div
          className="mt-8"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            paddingTop: 20,
            borderTop: '1px solid var(--ds-border)',
          }}
        >
          <div>
            {overridden ? (
              <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm ds-focusable" onClick={resetBranding}>
                Reset to defaults
              </button>
            ) : null}
          </div>
          <div className="flex items-center" style={{ gap: 12 }}>
            {error ? (
              <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-danger)', maxWidth: 260, textAlign: 'right' }}>{error}</span>
            ) : dirty ? (
              <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>Unsaved changes</span>
            ) : saved ? (
              <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-success)' }}>Saved ✓</span>
            ) : null}
            <button
              type="button"
              className="ds-btn ds-btn--primary ds-focusable"
              disabled={!dirty || saving}
              onClick={saveBranding}
              style={{ opacity: !dirty && !saving ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              {saving ? 'Saving…' : dirty ? 'Save changes' : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" /> Saved
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
