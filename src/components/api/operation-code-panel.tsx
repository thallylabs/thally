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
      <div className="overflow-hidden rounded-2xl border border-border/40">
        <div className="flex items-center justify-between border-b border-border/30 bg-muted/60 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Request</span>
            <span className="text-[10px] uppercase tracking-widest text-foreground/40">cURL</span>
          </div>
          <CopyButton
            value={preparedRequest.curlLines.join('\n')}
            disabled={!preparedRequest.isServerConfigured || !preparedRequest.curlLines.length}
            className="flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1 text-xs text-foreground/60 transition hover:text-foreground disabled:opacity-40"
          />
        </div>
        <pre className="scrollbar-hide max-h-[280px] overflow-auto bg-background/70 p-4 text-xs leading-relaxed text-foreground/80">
          {preparedRequest.curlLines.length
            ? preparedRequest.curlLines.join('\n')
            : 'Configure a server URL to preview the generated curl command.'}
        </pre>
      </div>

      {/* Response — styled like ResponseExample */}
      <div className="overflow-hidden rounded-2xl border border-border/40">
        <div className="flex items-center justify-between border-b border-border/30 bg-muted/60 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">Response</span>
            {response && 'status' in response ? (
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                response.status >= 200 && response.status < 300
                  ? 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                  : 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400',
              )}>
                {response.status}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-h-[80px] bg-background/70 p-4">
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
