'use client'

import { getMethodToken } from '@/components/api/tokens'
import type { NormalizedOperation } from '@/lib/openapi/types'
import { cn } from '@/lib/utils'

/** Method badge, server + path, and the Try it button shared by every API page. */
export function EndpointBar({ operation, onTryIt }: { operation: NormalizedOperation; onTryIt: () => void }) {
  const methodToken = getMethodToken(operation.method)
  return (
    <div className="flex flex-wrap items-center gap-4 border-y border-border py-3">
      <span className={cn('rounded-[5px] px-2 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-[0.02em]', methodToken.bg, methodToken.text)}>{operation.method}</span>
      <code className="flex-1 text-sm font-semibold text-foreground break-all">
        {(operation.servers[0]?.url?.replace(/\/$/, '') ?? '')}
        {operation.path}
      </code>
      <button
        type="button"
        onClick={onTryIt}
        className="rounded-[9px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-125 active:scale-[0.98]"
      >
        Try it
      </button>
    </div>
  )
}
