/**
 * Locked state for cloud-tier admin panels (Track, AI answers, analytics…).
 * Free self-hosted deployments render this where the feature UI would be —
 * the upsell surface from notes/thally-cloud-plan.md §4. Engine-side by
 * design: the panel exists in OSS; only the service behind it is cloud.
 */

const FEATURE_COPY: Record<string, { eyebrow: string; title: string; body: string }> = {
  track: {
    eyebrow: 'Workflow',
    title: 'Thally Track',
    body:
      'Track watches your product repos and drafts documentation PRs automatically when code merges — one-click GitHub App, task queue, and loop guard included.',
  },
  analytics: {
    eyebrow: 'Insights',
    title: 'Docs analytics',
    body:
      'See traffic by page and visitor type, search terms with zero results, and the content gaps your readers hit — for humans and AI agents alike.',
  },
  aiChat: {
    eyebrow: 'AI',
    title: 'Thally AI answers',
    body:
      'A chat assistant that answers visitor questions from your documentation, with citations, streaming responses, and usage insights.',
  },
}

export function CloudLockedPanel({ feature }: { feature: keyof typeof FEATURE_COPY }) {
  const copy = FEATURE_COPY[feature]
  return (
    <div className="ds-rise">
      <header className="mb-8">
        <div className="ds-eyebrow">{copy.eyebrow}</div>
        <h1 style={{ fontFamily: 'var(--ds-font-heading)', fontSize: 'var(--ds-text-h2)', fontWeight: 'var(--ds-fw-bold)', lineHeight: 1.1 }}>
          {copy.title}
        </h1>
      </header>
      <section className="ds-panel">
        <div className="ds-panel-head">
          <div className="ds-panel-title">Available on Thally Cloud</div>
        </div>
        <div className="p-5">
          <p className="max-w-[60ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            {copy.body}
          </p>
          <p className="mt-3 max-w-[60ch]" style={{ fontSize: 'var(--ds-text-sm)', color: 'var(--ds-text-muted)' }}>
            This self-hosted deployment doesn&apos;t include the {copy.title} service. Connect the site to Thally
            Thally Cloud to activate it — your docs stay in your repo, on your hosting.
          </p>
          <a
            className="ds-btn ds-btn--primary mt-5 inline-flex"
            href="https://thally.io/pricing"
            target="_blank"
            rel="noreferrer"
          >
            Connect to Thally Cloud
          </a>
        </div>
      </section>
    </div>
  )
}
