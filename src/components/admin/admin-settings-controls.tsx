'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { Role } from '@/lib/auth/types'
import { DEFAULT_AI_DISCLAIMER } from '@/lib/ai-defaults'

interface Domain {
  domain: string
  role: Role
}
interface Settings {
  chatEnabled: boolean | null
  analyticsEnabled: boolean | null
  aiLabel: string | null
  aiDisclaimer: string | null
  allowedDomains: Array<Domain>
  hasDocsPassword: boolean
  hasChatKey: boolean
}

/**
 * Write-only secret editor — never renders the value. `pending` is the staged
 * edit held by the parent draft: a string to set, null to clear, undefined for
 * unchanged. Saved by the group's global Save button.
 *
 * "Set" state is signalled quietly: a masked-dot placeholder + a small green
 * check + a gray caption (Configured / Ready to save / Not configured). No
 * colored status pill.
 */
function SecretRow({
  label,
  desc,
  isSet,
  pending,
  disabled,
  placeholder,
  maskedPlaceholder,
  onChange,
}: {
  label: string
  desc: React.ReactNode
  isSet: boolean
  pending: string | null | undefined
  disabled: boolean
  placeholder: string
  maskedPlaceholder: string
  onChange: (v: string | null | undefined) => void
}) {
  const stagedClear = pending === null
  const configured = isSet && !stagedClear
  const caption = pending !== undefined ? 'Ready to save' : isSet ? 'Configured' : 'Not configured'
  // Show the masked dots only when a secret is saved and untouched — so it's
  // clear something exists without exposing it. Typing or clearing reverts to
  // the plain placeholder.
  const shownPlaceholder = configured && pending === undefined ? maskedPlaceholder : placeholder

  return (
    <div className="ds-settings-row ds-settings-row--top">
      <div className="min-w-0">
        <div className="ds-setting-row-label">{label}</div>
        <div className="ds-setting-row-desc">{desc}</div>
      </div>
      <div className="ds-settings-control">
        <div className="ds-settings-field">
          <input
            type="password"
            className="ds-input ds-focusable"
            style={{ width: 200 }}
            placeholder={shownPlaceholder}
            value={typeof pending === 'string' ? pending : ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
          />
          {configured ? <Check className="ds-settings-check h-4 w-4" aria-hidden="true" /> : null}
          {isSet && !disabled ? (
            <button
              type="button"
              className="ds-linkbtn ds-focusable"
              onClick={() => onChange(stagedClear ? undefined : null)}
            >
              {stagedClear ? 'Undo' : 'Clear'}
            </button>
          ) : null}
        </div>
        <span className={`ds-settings-caption${pending !== undefined ? ' ds-settings-caption--staged' : ''}`}>{caption}</span>
      </div>
    </div>
  )
}

function Switch({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="ds-focusable"
      style={{
        width: 42,
        height: 24,
        flexShrink: 0,
        borderRadius: 999,
        border: 'none',
        padding: 2,
        background: on ? 'var(--ds-accent)' : 'var(--ds-surface-active)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 0.15s ease',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: '#fff',
          transform: on ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 0.15s ease',
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  )
}

function ToggleRow({
  label,
  desc,
  on,
  disabled,
  onToggle,
}: {
  label: string
  desc: string
  on: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <div className="ds-settings-row">
      <div className="min-w-0">
        <div className="ds-setting-row-label">{label}</div>
        <div className="ds-setting-row-desc">{desc}</div>
      </div>
      <Switch on={on} disabled={disabled} onToggle={onToggle} />
    </div>
  )
}

/** Small section header — brand-accent uppercase eyebrow. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="ds-settings-eyebrow">{children}</div>
}

function LocalizationSection({
  locales,
  repoUrl,
  canEdit,
}: {
  locales: Array<{ code: string; label: string }>
  repoUrl: string
  canEdit: boolean
}) {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const editUrl = repoUrl ? `${repoUrl.replace(/\/$/, '')}/edit/main/docs.json` : ''
  const valid = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code.trim()) && Boolean(label.trim())
  const snippet = valid ? `{ "code": "${code.trim()}", "label": "${label.trim()}" }` : ''

  return (
    <div className="ds-settings-row ds-settings-row--top">
      <div className="min-w-0">
        <div className="ds-setting-row-label">Languages</div>
        <div className="ds-setting-row-desc">
          Supported locales (<code className="font-mono">docs.json</code> i18n). Adding one is a reviewed config change; translate
          content with <code className="font-mono">dox translate</code>.
        </div>
      </div>
      <div className="ds-settings-control">
        {canEdit ? (
          <div className="ds-settings-addrow">
            <input
              className="ds-input ds-focusable"
              style={{ width: 70 }}
              placeholder="es"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              className="ds-input ds-focusable"
              style={{ width: 130 }}
              placeholder="Español"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {editUrl ? (
              <a
                href={valid ? editUrl : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!valid}
                className="ds-btn ds-btn--primary ds-btn--sm ds-focusable"
                style={{ opacity: valid ? 1 : 0.55, pointerEvents: valid ? undefined : 'none' }}
              >
                Add
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="ds-settings-chips">
          {locales.length === 0 ? (
            <span className="ds-settings-caption">Single language</span>
          ) : (
            locales.map((l) => (
              <span key={l.code} className="ds-chip ds-chip--neutral ds-chip--sm">
                {l.label}
                <span className="ds-chip-badge">{l.code}</span>
              </span>
            ))
          )}
        </div>
        {canEdit && valid && !editUrl ? (
          <span className="ds-settings-caption">
            Add <code className="font-mono">{snippet}</code> to <code className="font-mono">docs.json</code> →{' '}
            <code className="font-mono">i18n.locales</code>.
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function AdminSettingsControls({
  canEdit,
  i18nLocales,
  repoUrl,
}: {
  canEdit: boolean
  i18nLocales: Array<{ code: string; label: string }>
  repoUrl: string
}) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<{
    chatEnabled: boolean | null
    analyticsEnabled: boolean | null
    aiLabel: string | null
    aiDisclaimer: string | null
    allowedDomains: Array<Domain>
  } | null>(null)
  const [pendDocs, setPendDocs] = useState<string | null | undefined>(undefined)
  const [pendKey, setPendKey] = useState<string | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [newRole, setNewRole] = useState<Role>('viewer')

  function load(s: Settings) {
    setSettings(s)
    setDraft({
      chatEnabled: s.chatEnabled,
      analyticsEnabled: s.analyticsEnabled,
      aiLabel: s.aiLabel,
      aiDisclaimer: s.aiDisclaimer,
      allowedDomains: s.allowedDomains,
    })
    setPendDocs(undefined)
    setPendKey(undefined)
  }
  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && load(s))
      .catch(() => {})
  }, [])

  if (!settings || !draft) return null

  const dirty =
    draft.chatEnabled !== settings.chatEnabled ||
    draft.analyticsEnabled !== settings.analyticsEnabled ||
    draft.aiLabel !== settings.aiLabel ||
    draft.aiDisclaimer !== settings.aiDisclaimer ||
    JSON.stringify(draft.allowedDomains) !== JSON.stringify(settings.allowedDomains) ||
    pendDocs !== undefined ||
    pendKey !== undefined

  async function saveAll() {
    if (!canEdit || !dirty || !draft) return
    setSaving(true)
    setSaved(false)
    setError(null)
    const patch: Record<string, unknown> = {
      chatEnabled: draft.chatEnabled,
      analyticsEnabled: draft.analyticsEnabled,
      aiLabel: draft.aiLabel,
      aiDisclaimer: draft.aiDisclaimer,
      allowedDomains: draft.allowedDomains,
    }
    if (pendDocs !== undefined) patch.docsPassword = pendDocs
    if (pendKey !== undefined) patch.chatKey = pendKey
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        load(await res.json())
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      } else {
        const body = await res.json().catch(() => ({}))
        const hint = res.status === 401 || res.status === 403 ? ' — you need Owner access' : ''
        setError(body.error ?? `Save failed (HTTP ${res.status}${hint})`)
      }
    } catch {
      setError('Save failed — could not reach the server.')
    } finally {
      setSaving(false)
    }
  }

  const chatOn = draft.chatEnabled ?? true
  const analyticsOn = draft.analyticsEnabled ?? true

  return (
    <div>
      {/* Toolbar — staged-save model: nothing writes until Save. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          marginBottom: 'var(--ds-space-16)',
        }}
      >
        <p className="ds-setting-group-desc" style={{ margin: 0, maxWidth: '52ch' }}>
          {canEdit ? 'Make your changes, then Save. Nothing is written until you do.' : 'Owner access required to edit.'}
        </p>
      </div>

      <section className="ds-settings-panel">
        <div className="ds-settings-section">
          <SectionLabel>Site experience</SectionLabel>
          <ToggleRow
            label="AI Chat widget"
            desc="Show the assistant on the docs site"
            on={chatOn}
            disabled={!canEdit}
            onToggle={() => setDraft({ ...draft, chatEnabled: !chatOn })}
          />
          <div className="ds-settings-row ds-settings-row--top">
            <div className="min-w-0">
              <div className="ds-setting-row-label">Assistant name</div>
              <div className="ds-setting-row-desc">Shown on the chat button and panel header. Blank uses the docs.json label (or “Ask AI”).</div>
            </div>
            <div className="ds-settings-control">
              <input
                className="ds-input ds-focusable"
                style={{ width: 200 }}
                placeholder="Ask AI"
                maxLength={40}
                disabled={!canEdit}
                value={draft.aiLabel ?? ''}
                onChange={(e) => setDraft({ ...draft, aiLabel: e.target.value || null })}
              />
            </div>
          </div>
          <div className="ds-settings-row ds-settings-row--top">
            <div className="min-w-0">
              <div className="ds-setting-row-label">Assistant disclaimer</div>
              <div className="ds-setting-row-desc">Shown at the foot of the chat panel. Blank uses the generic “answers may be inaccurate” notice.</div>
            </div>
            <div className="ds-settings-control">
              <textarea
                className="ds-input ds-focusable"
                style={{ width: 280, minHeight: 68, resize: 'vertical' }}
                placeholder={DEFAULT_AI_DISCLAIMER}
                maxLength={300}
                disabled={!canEdit}
                value={draft.aiDisclaimer ?? ''}
                onChange={(e) => setDraft({ ...draft, aiDisclaimer: e.target.value || null })}
              />
            </div>
          </div>
          <ToggleRow
            label="Analytics collection"
            desc="Record page views + agent traffic for the dashboard"
            on={analyticsOn}
            disabled={!canEdit}
            onToggle={() => setDraft({ ...draft, analyticsEnabled: !analyticsOn })}
          />
        </div>

        <div className="ds-settings-section">
          <SectionLabel>Access &amp; keys</SectionLabel>
          <SecretRow
            label="Docs access password"
            desc={
              <>
                Password for the private-docs visitor gate. Set <code className="font-mono">DOX_ACCESS_PASSWORD</code> (any value)
                to turn the gate on; this password then takes precedence.
              </>
            }
            isSet={settings.hasDocsPassword}
            pending={pendDocs}
            disabled={!canEdit}
            placeholder="new password"
            maskedPlaceholder="••••••••••••"
            onChange={setPendDocs}
          />
          <SecretRow
            label="AI Chat API key"
            desc={
              <>
                Anthropic API key for the assistant, <strong>encrypted at rest</strong>. Overrides the{' '}
                <code className="font-mono">ANTHROPIC_API_KEY</code> env. Requires <code className="font-mono">DOX_AUTH_SECRET</code>.
              </>
            }
            isSet={settings.hasChatKey}
            pending={pendKey}
            disabled={!canEdit}
            placeholder="sk-ant-…"
            maskedPlaceholder="sk-ant-••••…"
            onChange={setPendKey}
          />
        </div>

        <div className="ds-settings-section">
          <SectionLabel>Team access</SectionLabel>
          <div className="ds-settings-row ds-settings-row--top">
            <div className="min-w-0">
              <div className="ds-setting-row-label">Allowed email domains</div>
              <div className="ds-setting-row-desc">
                Verified work emails in these domains can sign in (merged with docs.json{' '}
                <code className="font-mono">team.domains</code>).
              </div>
            </div>
            <div className="ds-settings-control">
              {canEdit ? (
                <div className="ds-settings-addrow">
                  <input
                    className="ds-input ds-focusable"
                    style={{ width: 130 }}
                    placeholder="acme.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                  />
                  <select className="ds-input ds-focusable" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="owner">owner</option>
                  </select>
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary ds-btn--sm ds-focusable"
                    disabled={!newDomain.trim()}
                    style={{ opacity: newDomain.trim() ? 1 : 0.55 }}
                    onClick={() => {
                      const domain = newDomain.trim().toLowerCase().replace(/^@/, '')
                      if (!domain) return
                      setDraft({ ...draft, allowedDomains: [...draft.allowedDomains, { domain, role: newRole }] })
                      setNewDomain('')
                    }}
                  >
                    Add
                  </button>
                </div>
              ) : null}
              <div className="ds-settings-chips">
                {draft.allowedDomains.length === 0 ? (
                  <span className="ds-settings-caption">None</span>
                ) : (
                  draft.allowedDomains.map((d, i) => (
                    <span key={`${d.domain}-${i}`} className="ds-chip ds-chip--neutral ds-chip--sm">
                      {d.domain}
                      <span className="ds-chip-badge">{d.role}</span>
                      {canEdit ? (
                        <button
                          type="button"
                          className="ds-chip-x ds-focusable"
                          aria-label={`Remove ${d.domain}`}
                          onClick={() => setDraft({ ...draft, allowedDomains: draft.allowedDomains.filter((_, j) => j !== i) })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="ds-settings-section">
          <SectionLabel>Localization</SectionLabel>
          <LocalizationSection locales={i18nLocales} repoUrl={repoUrl} canEdit={canEdit} />
        </div>
      </section>

      {canEdit ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            marginTop: 'var(--ds-space-16)',
            paddingTop: 'var(--ds-space-16)',
            borderTop: '1px solid var(--ds-border)',
          }}
        >
          {error ? (
            <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-danger)', maxWidth: 320, textAlign: 'right' }}>
              {error}
            </span>
          ) : saved ? (
            <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-success)' }}>Saved ✓</span>
          ) : null}
          <button
            type="button"
            className="ds-btn ds-btn--primary ds-focusable"
            disabled={!dirty || saving}
            onClick={saveAll}
            style={{ opacity: !dirty && !saving ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {saving ? 'Saving…' : dirty ? 'Save changes' : (
              <>
                <Check className="h-4 w-4" aria-hidden="true" /> Saved
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  )
}
