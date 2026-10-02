'use client'

import { CopyButton } from '@/components/api/copy-button'
import { useApiLabels } from '@/components/api/api-locale'
import { getMethodToken } from '@/components/api/tokens'
import type { NormalizedOperation } from '@/lib/openapi/types'
import type { PlaygroundDisplay } from '@/lib/openapi/playground-display'
import { cn } from '@/lib/utils'

/**
 * Method badge, path, and the Try it button shared by every API page.
 * `simple` shows a copyable endpoint with no playground; `none` shows nothing.
 */
export function EndpointBar({
  operation,
  onTryIt,
  display = 'interactive',
}: {
  operation: NormalizedOperation
  onTryIt: () => void
  display?: PlaygroundDisplay
}) {
  const t = useApiLabels()
  if (display === 'none') return null
  const methodToken = getMethodToken(operation.method)
  return (
    <div className="flex flex-wrap items-center gap-4 border-y border-border py-3">
      <span className={cn('rounded-[5px] px-2 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-[0.02em]', methodToken.bg, methodToken.text)}>{operation.isWebhook ? t('webhook') : operation.method}</span>
      <code className="min-w-0 flex-1 !whitespace-normal text-sm font-semibold text-foreground break-all">
        {operation.path}
      </code>
      {operation.isWebhook ? null : display === 'simple' ? (
        <CopyButton
          value={operation.path}
          className="flex items-center gap-1.5 rounded-[9px] border border-border px-3 py-2 text-xs text-foreground/70 transition hover:bg-muted hover:text-foreground"
        />
      ) : (
        <button
          type="button"
          onClick={onTryIt}
          className="rounded-[9px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-125 active:scale-[0.98]"
        >
          {t('tryIt')}
        </button>
      )}
    </div>
  )
}
