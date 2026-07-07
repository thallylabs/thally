'use client'

import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Tool {
  name: string
  description: string
}

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <pre
        className="overflow-x-auto p-3 pr-10"
        style={{ background: 'var(--ds-surface-tint)', borderRadius: 'var(--ds-radius-lg)', fontSize: 'var(--ds-text-caption)', fontFamily: 'var(--ds-font-mono)' }}
      >
        {code}
      </pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
        className="ds-iconbtn ds-focusable"
        style={{ position: 'absolute', top: 8, right: 8 }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export function McpView({
  endpoint,
  tools,
  ratePerMin,
  canEdit,
}: {
  endpoint: string
  tools: Array<Tool>
  ratePerMin: number
  canEdit: boolean
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setEnabled(s.mcpEnabled ?? true))
      .catch(() => {})
  }, [])

  async function toggle() {
    if (!canEdit || enabled === null) return
    const next = !enabled
    setEnabled(next)
    setSaving(true)
    try {
      await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mcpEnabled: next }),
      })
    } finally {
      setSaving(false)
    }
  }

  const claudeCmd = `claude mcp add --transport http dox-docs ${endpoint}`
  const cursorJson = `{
  "mcpServers": {
    "dox-docs": { "url": "${endpoint}" }
  }
}`
  const vscodeJson = `{
  "servers": {
    "dox-docs": { "type": "http", "url": "${endpoint}" }
  }
}`
  const zedJson = `{
  "context_servers": {
    "dox-docs": { "source": "custom", "url": "${endpoint}" }
  }
}`
  const curlCmd = `curl -sX POST ${endpoint} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

  return (
    <div className="ds-rise">
      <header className="mb-8">
        <div className="ds-eyebrow">Agents</div>
        <h1 style={{ fontFamily: 'var(--ds-font-heading)', fontSize: 'var(--ds-text-h2)', fontWeight: 'var(--ds-fw-bold)', lineHeight: 1.1 }}>
          MCP server
        </h1>
        <p className="mt-1.5 max-w-[62ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          Your docs site is a Model Context Protocol server. Any MCP client (Claude, Cursor, …) can attach and query the docs as
          native tools — no scraping.
        </p>
      </header>

      <section className="ds-panel">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Endpoint</div>
          <button
            type="button"
            aria-pressed={enabled ?? true}
            disabled={!canEdit || saving || enabled === null}
            onClick={toggle}
            className={`ds-chip ds-chip--${enabled === false ? 'neutral' : 'success'}`}
            style={{ cursor: canEdit ? 'pointer' : 'default', border: 'none' }}
            title={canEdit ? 'Toggle the public MCP endpoint' : 'Owner/Editor only'}
          >
            {enabled === false ? null : <span className="ds-dot" />}
            {enabled === null ? '…' : enabled === false ? 'Disabled' : 'Enabled'}
          </button>
        </div>
        <CopyBlock code={endpoint} />
        <p className="mt-3" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
          Public, read-only, rate-limited to <strong>{ratePerMin}</strong> tool calls/min per IP.
        </p>
      </section>

      <section className="ds-panel mt-6">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Connect</div>
        </div>
        <div className="space-y-4">
          <div>
            <p className="ds-rail-label mb-1.5">Claude Code</p>
            <CopyBlock code={claudeCmd} />
          </div>
          <div>
            <p className="ds-rail-label mb-1.5">Cursor · Windsurf · Cline (mcp.json)</p>
            <CopyBlock code={cursorJson} />
          </div>
          <div>
            <p className="ds-rail-label mb-1.5">VS Code · GitHub Copilot (.vscode/mcp.json)</p>
            <CopyBlock code={vscodeJson} />
          </div>
          <div>
            <p className="ds-rail-label mb-1.5">Zed (settings.json)</p>
            <CopyBlock code={zedJson} />
          </div>
          <div>
            <p className="ds-rail-label mb-1.5">Any other client — raw HTTP (JSON-RPC 2.0)</p>
            <CopyBlock code={curlCmd} />
          </div>
        </div>
      </section>

      <section className="ds-panel mt-6">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Available tools ({tools.length})</div>
        </div>
        <table className="ds-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td>
                  <span className="font-mono" style={{ fontSize: 'var(--ds-text-caption)' }}>{t.name}</span>
                </td>
                <td style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>{t.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
