'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiLocaleProvider } from '@/components/api/api-locale'
import { EndpointBar } from '@/components/api/endpoint-bar'
import { OperationCodePanel } from '@/components/api/operation-code-panel'
import { TryItDialog } from '@/components/api/try-it-dialog'
import { useTryItController, type TryItController } from '@/components/api/use-try-it-controller'
import { usePageSlots } from '@/components/mdx/page-slots'
import type { NormalizedOperation } from '@/lib/openapi/types'
import type { PlaygroundDisplay } from '@/lib/openapi/playground-display'

/** Endpoint header + Try It for a page authored with `api:` frontmatter. */
export function ManualApiEndpoint({ operation, playground = 'interactive', locale }: { operation: NormalizedOperation; playground?: PlaygroundDisplay; locale?: string }) {
  return <ManualApiEndpointContent key={`${operation.specId}:${operation.manualPage ?? operation.id}:${operation.key}`} operation={operation} playground={playground} locale={locale} />
}

function ManualApiEndpointContent({ operation, playground, locale }: { operation: NormalizedOperation; playground: PlaygroundDisplay; locale?: string }) {
  const controller = useTryItController(operation)
  const [open, setOpen] = useState(false)
  return (
    <ApiLocaleProvider value={locale}>
    <div className="not-prose mb-8" data-manual-api="">
      <EndpointBar operation={operation} display={playground} onTryIt={() => setOpen(true)} />
      {operation.servers.length === 0 ? (
        <p className="mt-2 text-xs text-foreground/60">
          Live requests are disabled: set <code>api.mdx.server</code> in docs.json or use a full URL in the page&apos;s <code>api</code> frontmatter.
        </p>
      ) : null}
      {operation.manualSamples && operation.servers.length > 0 ? <GeneratedSamples controller={controller} /> : null}
      {playground === 'interactive' ? <TryItDialog controller={controller} open={open} onOpenChange={setOpen} /> : null}
    </div>
    </ApiLocaleProvider>
  )
}

/** Request samples built from the `api:` line, in the page's code rail like an `openapi:` page's. */
function GeneratedSamples({ controller }: { controller: TryItController }) {
  const { panelTarget, registerPanel } = usePageSlots()
  useEffect(() => registerPanel(), [registerPanel])
  return panelTarget ? createPortal(<div className="not-prose space-y-4 pb-6" data-mdx-panel><OperationCodePanel controller={controller} /></div>, panelTarget) : null
}
