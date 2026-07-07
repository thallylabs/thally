'use client'

import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { Role } from '@/lib/auth/types'

interface Member {
  email: string
  role: string
}
interface Domain {
  domain: string
  role: string
}

function RoleChip({ role }: { role: string }) {
  const tone = role === 'owner' ? 'ds-chip--success' : role === 'editor' ? 'ds-chip--neutral' : 'ds-chip--warn'
  return <span className={`ds-chip ${tone}`}>{role}</span>
}

export function TeamView({
  members,
  domains,
  viewerRole,
  viewerEmail,
  repoUrl,
}: {
  members: Array<Member>
  domains: Array<Domain>
  viewerRole: Role
  viewerEmail: string
  repoUrl: string
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const canManage = viewerRole === 'owner'
  const editUrl = repoUrl ? `${repoUrl.replace(/\/$/, '')}/edit/main/docs.json` : ''
  const snippet = `{ "email": "${email || 'name@company.com'}", "role": "${role}" }`

  return (
    <div className="ds-rise">
      <header className="mb-8">
        <div className="ds-eyebrow">Access</div>
        <h1 style={{ fontFamily: 'var(--ds-font-heading)', fontSize: 'var(--ds-text-h2)', fontWeight: 'var(--ds-fw-bold)', lineHeight: 1.1 }}>
          Team
        </h1>
        <p className="mt-1.5 max-w-[60ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          The admin roster lives in <code className="font-mono">docs.json</code> — version-controlled and code-reviewed. You're signed in
          as <strong>{viewerEmail}</strong> (<RoleChip role={viewerRole} />).
        </p>
      </header>

      <section className="ds-panel">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Members</div>
        </div>
        {members.length === 0 ? (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>No explicit members — access is by domain (below) or the break-glass password.</p>
        ) : (
          <table className="ds-table">
            <thead>
              <tr><th>Email</th><th className="ds-num">Role</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.email}>
                  <td><span className="font-mono" style={{ fontSize: 'var(--ds-text-caption)' }}>{m.email}</span></td>
                  <td className="ds-num"><RoleChip role={m.role} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {domains.length > 0 ? (
        <section className="ds-panel mt-6">
          <div className="ds-panel-head"><div className="ds-panel-title">Domains</div></div>
          <div className="flex flex-wrap gap-2">
            {domains.map((d) => (
              <span key={d.domain} className="ds-chip ds-chip--neutral">
                @{d.domain} → {d.role}
              </span>
            ))}
          </div>
          <p className="mt-3" style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
            Anyone with a verified work email in these domains signs in with the default role.
          </p>
        </section>
      ) : null}

      <section className="ds-panel mt-6">
        <div className="ds-panel-head"><div className="ds-panel-title">Invite</div></div>
        {canManage ? (
          <>
            <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
              Inviting adds a line to the <code className="font-mono">team.members</code> array. Open a reviewed PR — that's the audit trail.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex-1" style={{ minWidth: 220 }}>
                <span className="ds-rail-label">Email</span>
                <input className="ds-input ds-focusable mt-1 w-full" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                <span className="ds-rail-label">Role</span>
                <select className="ds-input ds-focusable mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="owner">owner</option>
                </select>
              </label>
            </div>
            <p className="mt-4 ds-rail-label">Add this to <code className="font-mono">team.members</code>:</p>
            <pre className="ds-code mt-2 overflow-x-auto p-3" style={{ background: 'var(--ds-surface-tint)', borderRadius: 'var(--ds-radius-lg)', fontSize: 'var(--ds-text-caption)' }}>
              {snippet}
            </pre>
            {editUrl ? (
              <a href={editUrl} target="_blank" rel="noreferrer" className="ds-btn ds-btn--primary ds-btn--sm ds-focusable mt-3">
                Edit docs.json on GitHub <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </>
        ) : (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>Only an Owner can change the roster.</p>
        )}
      </section>
    </div>
  )
}
