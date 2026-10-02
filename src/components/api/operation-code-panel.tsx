import { useState } from 'react'
import { CopyButton } from '@/components/api/copy-button'
import type { TryItController } from '@/components/api/use-try-it-controller'
import { ResponseBody } from '@/components/api/try-it-panel'
import { statusColorClass, statusUnderlineClass } from '@/components/api/tokens'
import { buildCodeSamples } from '@/lib/openapi/code-samples'
import { formatExample, responseExamples } from '@/lib/openapi/response-examples'
import { resolvePreferredLanguage, usePreferredLanguageStore } from '@/lib/preferred-language'
import { cn } from '@/lib/utils'

interface OperationCodePanelProps {
  controller: TryItController
}

export function OperationCodePanel({ controller }: OperationCodePanelProps) {
  const { preparedRequest, operation } = controller
  const { preferredLanguages, addPreferredLanguage } = usePreferredLanguageStore()
  const samples = buildCodeSamples(preparedRequest, operation.codeSamples)
  const language = resolvePreferredLanguage(samples.map((sample) => sample.label), preferredLanguages)
  const sample = samples.find((candidate) => candidate.label === language)

  return (
    <div className="space-y-4">
      {/* Request — styled like RequestExample */}
      <div className="overflow-hidden rounded-[11px] border border-border bg-muted/40">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Request</span>
          </div>
          <div className="flex items-center gap-1">
            {samples.length ? (
              <select
                aria-label="Select language"
                value={language}
                onChange={(event) => addPreferredLanguage(event.target.value)}
                className="rounded-[7px] bg-transparent px-1 py-1 text-xs text-foreground/60 hover:text-foreground"
              >
                {samples.map((candidate) => (
                  <option key={candidate.label} value={candidate.label}>{candidate.label}</option>
                ))}
              </select>
            ) : null}
            <CopyButton
              value={sample?.source ?? ''}
              disabled={!sample}
              className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-xs text-foreground/60 transition hover:bg-muted hover:text-foreground disabled:opacity-40"
            />
          </div>
        </div>
        <pre className="scrollbar-hide max-h-[280px] overflow-auto bg-transparent p-4 font-mono text-[0.82rem] leading-[1.65] text-foreground/80">
          {sample ? sample.source : 'Configure a server URL to preview the generated code sample.'}
        </pre>
      </div>

      <ResponseExamples controller={controller} />
    </div>
  )
}

/** Response box: a tab per status in the spec with its example, plus the real result once a request was sent. */
function ResponseExamples({ controller }: OperationCodePanelProps) {
  const { operation, response } = controller
  // A status with no body has nothing to show, so it gets no tab, as on live.
  const withExamples = operation.responses.filter((candidate) => responseExamples(candidate).length)
  const sent = response && 'body' in response ? response : null
  const [pick, setPick] = useState<{ code: string; at: unknown } | null>(null)
  const [exampleKeys, setExampleKeys] = useState<Record<string, string>>({})
  // A new result takes the tab back; a pick only holds for the result it was made against.
  const active = pick && pick.at === response ? pick.code : sent ? 'sent' : (withExamples[0]?.code ?? '')
  const activeResponse = withExamples.find((candidate) => candidate.code === active)
  const examples = activeResponse ? responseExamples(activeResponse) : []
  const example = examples.find((candidate) => candidate.key === exampleKeys[active]) ?? examples[0]
  const tabs = [...(sent ? [{ code: 'sent', label: String(sent.status), status: String(sent.status) }] : []), ...withExamples.map((r) => ({ code: r.code, label: r.code, status: r.code }))]

  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-muted/40">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2" role="tablist" aria-label="Response status">
        {sent ? <span className="px-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">Result</span> : null}
        {tabs.map((tab, index) => (
          <button
            key={tab.code}
            type="button"
            role="tab"
            aria-selected={tab.code === active}
            onClick={() => setPick({ code: tab.code, at: response })}
            className={cn(
              'relative px-2.5 py-2 text-xs font-semibold transition',
              tab.code === active ? statusColorClass(tab.status) : 'text-foreground/40 hover:text-foreground/70',
              sent && index === 1 ? 'ml-2 border-l border-border' : '',
            )}
          >
            {tab.label}
            {tab.code === active ? <span className={cn('absolute inset-x-1 -bottom-px h-0.5 rounded-full', statusUnderlineClass(tab.status))} /> : null}
          </button>
        ))}
        {!tabs.length ? <span className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">Response</span> : null}
      </div>
      <div className="min-h-[80px] bg-transparent p-4">
        {active === 'sent' && sent ? (
          <ResponseBody body={sent.body} />
        ) : example ? (
          <div className="space-y-2">
            {examples.length > 1 ? (
              <select
                aria-label="Select example"
                value={example.key}
                onChange={(event) => setExampleKeys((prev) => ({ ...prev, [active]: event.target.value }))}
                className="rounded-[7px] border border-border bg-transparent px-1 py-1 text-xs text-foreground/70"
              >
                {examples.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
                ))}
              </select>
            ) : null}
            <pre className="scrollbar-hide max-h-[320px] overflow-auto font-mono text-[0.82rem] leading-[1.65] text-foreground/80">{formatExample(example.value)}</pre>
          </div>
        ) : (
          <p className="text-xs text-foreground/50">Send a request to preview the response.</p>
        )}
      </div>
    </div>
  )
}
