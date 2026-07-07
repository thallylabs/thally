'use client'

import { Loader2 } from 'lucide-react'
import type { TryItController } from '@/components/api/use-try-it-controller'
import { CopyButton } from '@/components/api/copy-button'
import { cn } from '@/lib/utils'

interface TryItPanelProps {
  controller: TryItController
  variant?: 'inline' | 'dialog'
  showHeading?: boolean
}

export function TryItPanel({ controller, variant = 'inline', showHeading = true }: TryItPanelProps) {
  const { operation, serverUrl, setServerUrl, pathParams, queryParams, headerParams, bodyValue, setBodyValue, setParamValue, preparedRequest, sendRequest, isSending, canSendBody, response } =
    controller
  const queryPairs = Object.entries(queryParams ?? {})
  const containerStyles =
    variant === 'dialog'
      ? 'space-y-4 rounded-2xl border border-border/30 bg-background/50 p-4'
      : 'space-y-4 rounded-2xl border border-border/40 bg-background/40 p-4'

  const heading = (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">Try It</p>
        <p className="text-sm text-foreground/70">Execute this endpoint with prefilled parameters.</p>
      </div>
      {operation.servers.length > 1 ? (
        <select
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          className="rounded-xl border border-border/50 bg-transparent px-3 py-1 text-sm"
        >
          {operation.servers.map((server) => (
            <option key={server.url} value={server.url}>
              {server.url}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sendRequest()
  }

  return (
    <section className={cn(containerStyles, variant === 'inline' && 'mt-6')} id={variant === 'inline' ? 'try-it' : undefined}>
      {showHeading ? heading : null}
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">Path parameters</p>
          {Object.keys(pathParams).length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(pathParams).map(([key, value]) => (
                <label key={key} className="space-y-1 text-sm text-foreground/70">
                  <span className="font-mono text-xs uppercase text-foreground/60">{key}</span>
                  <input
                    value={value}
                    onChange={(event) => setParamValue('path', key, event.target.value)}
                    className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/50">No path parameters.</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">Query parameters</p>
          {queryPairs.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {queryPairs.map(([key, value]) => (
                <label key={key} className="space-y-1 text-sm text-foreground/70">
                  <span className="font-mono text-xs uppercase text-foreground/60">{key}</span>
                  <input
                    value={value}
                    onChange={(event) => setParamValue('query', key, event.target.value)}
                    className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/50">No query parameters.</p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">Headers</p>
          {Object.keys(headerParams).length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(headerParams).map(([key, value]) => (
                <label key={key} className="space-y-1 text-sm text-foreground/70">
                  <span className="font-mono text-xs uppercase text-foreground/60">{key}</span>
                  <input
                    value={value}
                    onChange={(event) => setParamValue('header', key, event.target.value)}
                    className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm"
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/50">No header parameters declared.</p>
          )}
        </div>
        {canSendBody ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">
              <p>Request body</p>
              <span className="text-[10px] text-foreground/50">JSON</span>
            </div>
            <textarea
              value={bodyValue}
              onChange={(event) => setBodyValue(event.target.value)}
              className="min-h-[180px] w-full rounded-2xl border border-border/40 bg-background/70 px-4 py-3 font-mono text-sm text-foreground"
            />
          </div>
        ) : null}
        {variant === 'inline' ? (
          <div className="flex flex-col items-end gap-2">
            {!preparedRequest.isServerConfigured ? (
              <p className="text-xs text-amber-400">Add a server URL to the OpenAPI spec to enable live requests.</p>
            ) : null}
            <button
              type="submit"
              disabled={isSending || !preparedRequest.isServerConfigured}
              className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send request
            </button>
          </div>
        ) : null}
      </form>
      <TryItResponse response={response} />
    </section>
  )
}

export function TryItResponse({ response }: { response: TryItController['response'] }) {
  if (!response) {
    return (
      <div className="rounded-2xl border border-dashed border-border/40 p-4 text-sm text-foreground/60">
        Responses will appear here.
      </div>
    )
  }

  if ('error' in response) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-500">
        {response.error}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border/40 bg-background/50 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusPill status={response.status} statusText={response.statusText} />
        <span className="text-xs text-foreground/60">{response.duration} ms</span>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">Body</p>
        <ResponseBody body={response.body} />
      </div>
    </div>
  )
}

function StatusPill({ status, statusText }: { status: number; statusText: string }) {
  const intent = status >= 200 && status < 300 ? 'success' : status >= 400 ? 'error' : 'info'
  const styles =
    intent === 'success'
      ? 'bg-accent/10 text-accent border-accent/30'
      : intent === 'error'
        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide', styles)}>
      {status}
      <span className="text-foreground/70">{statusText}</span>
    </span>
  )
}

function formatBody(body: string) {
  try {
    const parsed = JSON.parse(body)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return body
  }
}

export function ResponseBody({ body }: { body: string }) {
  return (
    <pre className="scrollbar-hide relative max-h-[320px] overflow-auto rounded-xl border border-border/40 bg-background/70 p-4 text-xs leading-relaxed text-foreground/80">
      <CopyButton
        value={body}
        className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-border/40 bg-background/80 px-1.5 py-1 text-[11px] text-foreground/60 transition hover:text-foreground"
      />
      {formatBody(body)}
    </pre>
  )
}

