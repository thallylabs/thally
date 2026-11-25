'use client'

/**
 * The assistant's controlled question form. Attachment controls are supplied
 * by the panel so file validation and draft ownership stay in one place.
 */

import { useEffect, useImperativeHandle, useRef, type ComponentProps, type ReactNode, type Ref } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatComposerProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  onStop: () => void
  isLoading: boolean
  isEnabled: boolean
  hasAttachments: boolean
  label: string
  inputRef?: Ref<HTMLTextAreaElement>
  onPaste?: ComponentProps<'textarea'>['onPaste']
  attachments?: ReactNode
  attachmentAction?: ReactNode
}

/** Enter sends, Shift+Enter inserts a line, and IME confirmation stays local. */
export function ChatComposer({ value, onValueChange, onSubmit, onStop, isLoading, isEnabled, hasAttachments, label, inputRef, onPaste, attachments, attachmentAction }: ChatComposerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(inputRef, () => fieldRef.current as HTMLTextAreaElement, [])
  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(Math.max(field.scrollHeight, 48), 160)}px`
  }, [value])
  const canSend = isEnabled && !isLoading && (Boolean(value.trim()) || hasAttachments)
  const submit = () => { if (canSend) onSubmit(value.trim()) }
  return (
    <form
      data-slot="chat-composer"
      onSubmit={(event) => { event.preventDefault(); submit() }}
      className="thally-docs-chat-composer rounded-[18px] border px-3 pb-2.5 pt-3 transition-[border-color,box-shadow] duration-150 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20 motion-reduce:transition-none"
    >
      {attachments}
      <textarea
        ref={fieldRef}
        value={value}
        rows={2}
        aria-label={`Message ${label}`}
        onChange={(event) => onValueChange(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event) => {
          // Browsers use either isComposing or the legacy IME key code when
          // Enter confirms input; neither is a request to send a question.
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault()
          if (!event.repeat) submit()
        }}
        placeholder={isEnabled ? 'Ask a question…' : 'AI chat is unavailable.'}
        disabled={isLoading || !isEnabled}
        className="block w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50 [scrollbar-width:thin]"
        style={{ maxHeight: 160 }}
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {attachmentAction}
        <button
          type={isLoading ? 'button' : 'submit'}
          onClick={isLoading ? onStop : undefined}
          disabled={!isLoading && !canSend}
          aria-label={isLoading ? 'Stop' : 'Send'}
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors disabled:opacity-30', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background')}
        >
          {isLoading ? <Square className="h-3 w-3 fill-current" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </form>
  )
}
