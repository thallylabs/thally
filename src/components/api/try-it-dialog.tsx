'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { useApiLabels } from '@/components/api/api-locale'
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

export function SendButton({ controller }: { controller: TryItController }) {
  const t = useApiLabels()
  const { isSending, confirmingSend, requestSend, cancelSend, preparedRequest } = controller
  return (
    <button
      type="button"
      onClick={requestSend}
      onBlur={cancelSend}
      disabled={!preparedRequest.isServerConfigured || isSending}
      className={cn(
        'flex items-center gap-2 rounded-[9px] px-5 py-2 text-sm font-semibold transition hover:brightness-125 disabled:opacity-50',
        confirmingSend ? 'bg-rose-600 text-white' : 'bg-primary text-primary-foreground',
      )}
    >
      {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {isSending ? t('sending') : confirmingSend ? t('confirmDelete') : t('send')}
    </button>
  )
}

/**
 * Full-viewport playground: endpoint and Send on top, the request form on the
 * left, the request sample and response on the right. Radix traps focus,
 * closes on Esc and returns focus to the control that opened it.
 */
export function TryItDialog({ controller, open, onOpenChange }: TryItDialogProps) {
  const t = useApiLabels()
  const { operation, serverUrl, setServerUrl, preparedRequest } = controller
  const methodToken = getMethodToken(operation.method)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background/70 backdrop-blur-md" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-[14px] border border-border bg-background shadow-2xl sm:inset-4 lg:inset-x-8 lg:inset-y-6"
        >
          <header className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <span className={cn('rounded-[5px] px-2 py-1 font-mono text-[0.7rem] font-medium uppercase tracking-[0.02em]', methodToken.bg, methodToken.text)}>
              {operation.method}
            </span>
            {operation.servers.length > 1 ? (
              <select
                aria-label={t('apiServer')}
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                className="rounded-[9px] border border-border bg-background px-3 py-1 text-sm"
              >
                {operation.servers.map((server) => (
                  <option key={server.url} value={server.url}>{server.url}</option>
                ))}
              </select>
            ) : null}
            <div
              className="min-w-0 flex-1 break-all rounded-[9px] border border-border px-3 py-2 font-mono text-xs text-foreground/80"
              title={preparedRequest.url || undefined}
            >
              {preparedRequest.url || t('noServer')}
            </div>
            <SendButton controller={controller} />
            <Dialog.Close asChild>
              <button type="button" className="rounded-[9px] border border-border p-2 text-foreground/70 transition hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
                <span className="sr-only">{t('close')}</span>
              </button>
            </Dialog.Close>
          </header>
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
            <div className="space-y-4 p-5 lg:overflow-y-auto">
              <Dialog.Title className="text-lg font-semibold">{operation.title}</Dialog.Title>
              {operation.description && operation.description !== operation.title ? (
                <div className="prose prose-neutral max-w-none text-sm text-foreground/60">
                  <Markdown>{operation.description}</Markdown>
                </div>
              ) : null}
              <TryItPanel controller={controller} variant="dialog" showHeading={false} />
            </div>
            <div className="border-t border-border bg-muted/20 p-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <OperationCodePanel controller={controller} />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
