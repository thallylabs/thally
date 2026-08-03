import { CopyButton } from '@/components/api/copy-button'
import type { TryItController } from '@/components/api/use-try-it-controller'
import { ResponseBody } from '@/components/api/try-it-panel'
import { cn } from '@/lib/utils'

interface OperationCodePanelProps {
  controller: TryItController
}

export function OperationCodePanel({ controller }: OperationCodePanelProps) {
  const { preparedRequest, response } = controller

  return (
    <div className="space-y-4">
      {/* Request — styled like RequestExample */}
      <div className="overflow-hidden rounded-[11px] border border-border bg-muted/40">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Request</span>
            <span className="text-[10px] uppercase tracking-widest text-foreground/40">cURL</span>
          </div>
          <CopyButton
            value={preparedRequest.curlLines.join('\n')}
            disabled={!preparedRequest.isServerConfigured || !preparedRequest.curlLines.length}
            className="flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-xs text-foreground/60 transition hover:bg-muted hover:text-foreground disabled:opacity-40"
          />
        </div>
        <pre className="scrollbar-hide max-h-[280px] overflow-auto bg-transparent p-4 font-mono text-[0.82rem] leading-[1.65] text-foreground/80">
          {preparedRequest.curlLines.length
            ? preparedRequest.curlLines.join('\n')
            : 'Configure a server URL to preview the generated curl command.'}
        </pre>
      </div>

      {/* Response — styled like ResponseExample */}
      <div className="overflow-hidden rounded-[11px] border border-border bg-muted/40">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Response</span>
            {response && 'status' in response ? (
              <span className={cn(
                'inline-flex items-center gap-1.5 text-[10px] font-semibold before:h-1.5 before:w-1.5 before:rounded-full before:bg-current',
                response.status >= 200 && response.status < 300
                  ? 'text-green-700 dark:text-green-400'
                  : 'text-rose-700 dark:text-rose-400',
              )}>
                {response.status}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-h-[80px] bg-transparent p-4">
          {response && 'body' in response ? (
            <ResponseBody body={response.body} />
          ) : (
            <p className="text-xs text-foreground/50">Send a request to preview the response.</p>
          )}
        </div>
      </div>
    </div>
  )
}
