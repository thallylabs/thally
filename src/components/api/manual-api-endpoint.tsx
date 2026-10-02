'use client'

import { useState } from 'react'
import { EndpointBar } from '@/components/api/endpoint-bar'
import { TryItDialog } from '@/components/api/try-it-dialog'
import { useTryItController } from '@/components/api/use-try-it-controller'
import type { NormalizedOperation } from '@/lib/openapi/types'
import type { PlaygroundDisplay } from '@/lib/openapi/playground-display'

/** Endpoint header + Try It for a page authored with `api:` frontmatter. */
export function ManualApiEndpoint({ operation, playground = 'interactive' }: { operation: NormalizedOperation; playground?: PlaygroundDisplay }) {
  const controller = useTryItController(operation)
  const [open, setOpen] = useState(false)
  return (
    <div className="not-prose mb-8" data-manual-api="">
      <EndpointBar operation={operation} display={playground} onTryIt={() => setOpen(true)} />
      {operation.servers.length === 0 ? (
        <p className="mt-2 text-xs text-foreground/60">
          Live requests are disabled: set <code>api.mdx.server</code> in docs.json or use a full URL in the page&apos;s <code>api</code> frontmatter.
        </p>
      ) : null}
      {playground === 'interactive' ? <TryItDialog controller={controller} open={open} onOpenChange={setOpen} /> : null}
    </div>
  )
}
