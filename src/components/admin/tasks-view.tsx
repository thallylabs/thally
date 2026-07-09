import type { DocsTask } from '@/lib/tasks'

export interface TrackedRepoStatus {
  owner: string
  repo: string
  branch: string
  paths: Array<string>
  outputTab?: string
  /** Last commit relayed by the Track webhook, or null before the first push. */
  lastSyncedSha: string | null
}

const STATE_TONE: Record<DocsTask['state'], string> = {
  open: 'ds-chip--warn',
  merged: 'ds-chip--success',
  closed: 'ds-chip--neutral',
}
const STATE_LABEL: Record<DocsTask['state'], string> = {
  open: 'In review',
  merged: 'Merged',
  closed: 'Closed',
}

export function TasksView({
  tasks,
  repoConfigured,
  trackedRepos = [],
}: {
  tasks: Array<DocsTask>
  repoConfigured: boolean
  trackedRepos?: Array<TrackedRepoStatus>
}) {
  const open = tasks.filter((t) => t.state === 'open').length

  return (
    <div className="ds-rise">
      <header className="mb-8">
        <div className="ds-eyebrow">Workflow</div>
        <h1 style={{ fontFamily: 'var(--ds-font-heading)', fontSize: 'var(--ds-text-h2)', fontWeight: 'var(--ds-fw-bold)', lineHeight: 1.1 }}>
          Docs tasks
        </h1>
        <p className="mt-1.5 max-w-[60ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
          Every task the docs agent drafts lands as a pull request to review. This is that queue{open ? ` — ${open} awaiting review` : ''}.
        </p>
      </header>

      <section className="ds-panel mb-6">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Tracked repos</div>
        </div>
        {trackedRepos.length === 0 ? (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            No product repos tracked yet. Run <code className="font-mono">dox track add &lt;owner/repo&gt;</code> to have
            commits there become docs PRs automatically.
          </p>
        ) : (
          <table className="ds-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Paths</th>
                <th className="ds-num">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {trackedRepos.map((r) => (
                <tr key={`${r.owner}/${r.repo}@${r.branch}`}>
                  <td className="max-w-0">
                    <a
                      href={`https://github.com/${r.owner}/${r.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate hover:underline"
                    >
                      {r.owner}/{r.repo}
                      <span style={{ color: 'var(--ds-text-muted)' }}>@{r.branch}</span>
                    </a>
                    {r.outputTab ? (
                      <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>
                        → {r.outputTab}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {r.paths.length === 0 ? (
                      <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>all files</span>
                    ) : (
                      r.paths.map((glob) => (
                        <span key={glob} className="ds-chip ds-chip--neutral ds-chip--sm font-mono" style={{ marginRight: 4 }}>
                          {glob}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="ds-num">
                    {r.lastSyncedSha ? (
                      <code className="font-mono" style={{ fontSize: 'var(--ds-text-caption)' }}>
                        {r.lastSyncedSha.slice(0, 7)}
                      </code>
                    ) : (
                      <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>never</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ds-panel">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Agent pull requests</div>
        </div>
        {!repoConfigured ? (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            Set your repository URL (<code className="font-mono">repoUrl</code> in <code className="font-mono">site.ts</code>) to see the
            agent&apos;s docs PRs here.
          </p>
        ) : tasks.length === 0 ? (
          <p style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            No agent docs PRs yet. When someone comments <code className="font-mono">@dox</code> on a product PR (or runs{' '}
            <code className="font-mono">dox agent</code>), the drafted PR shows up here.
          </p>
        ) : (
          <table className="ds-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Origin</th>
                <th className="ds-num">Status</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.number}>
                  <td className="max-w-0">
                    <a href={t.url} target="_blank" rel="noreferrer" className="block truncate hover:underline" title={t.title}>
                      #{t.number} {t.title}
                    </a>
                    <span style={{ fontSize: 'var(--ds-text-caption)', color: 'var(--ds-text-muted)' }}>{t.author}</span>
                  </td>
                  <td>
                    <span className="ds-chip ds-chip--neutral">{t.origin}</span>
                  </td>
                  <td className="ds-num">
                    <span className={`ds-chip ${STATE_TONE[t.state]}`}>{STATE_LABEL[t.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
