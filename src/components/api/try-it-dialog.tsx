'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { TryItPanel } from '@/components/api/try-it-panel'
import { Markdown } from '@/components/mdx/markdown'
import { OperationCodePanel } from '@/components/api/operation-code-panel'
import type { TryItController } from '@/components/api/use-try-it-controller'
import { getMethodToken } from '@/components/api/tokens'
import { cn } from '@/lib/utils'

interface TryItDialogProps {
  controller: TryItController
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TryItDialog({ controller, open, onOpenChange }: TryItDialogProps) {
  const methodToken = getMethodToken(controller.operation.method)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background/70 backdrop-blur-md" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => onOpenChange(false)}>
          <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-border/40 bg-background/95 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <header className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Dialog.Title className="text-lg font-semibold">Execute {controller.operation.title}</Dialog.Title>
                {controller.operation.description ? (
                  <div className="prose prose-neutral max-w-none text-sm text-foreground/60">
                    <Markdown>{controller.operation.description}</Markdown>
                  </div>
                ) : null}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <span className={cn('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest', methodToken.bg, methodToken.text)}>
                  {controller.operation.method}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">Resolved URL</span>
                  <div
                    className="w-64 max-w-full truncate rounded-xl border border-border/40 bg-transparent px-3 py-1 font-mono text-xs text-foreground/80"
                    title={controller.preparedRequest.url || undefined}
                  >
                    {controller.preparedRequest.url || 'Select a server to build the URL'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void controller.sendRequest()}
                  disabled={!controller.preparedRequest.isServerConfigured || controller.isSending}
                  className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-foreground shadow transition hover:bg-accent/90 disabled:opacity-50"
                >
                  {controller.isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {controller.isSending ? 'Sending' : 'Send'}
                </button>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-full border border-border/40 p-2 text-foreground/70 transition hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                  </button>
                </Dialog.Close>
              </div>
            </header>
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <TryItPanel controller={controller} variant="dialog" showHeading={false} />
              <OperationCodePanel controller={controller} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

