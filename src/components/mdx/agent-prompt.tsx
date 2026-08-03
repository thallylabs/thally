'use client'

/**
 * Copyable, agent-ready instructions for task-focused documentation guides.
 * Clipboard text is read from the rendered prompt so rich MDX and copied
 * instructions always stay aligned.
 */
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface AgentPromptProps {
  title?: string
  copyOnly?: boolean
  children: ReactNode
}

async function copyText(value: string): Promise<boolean> {
  try {
    await window.navigator.clipboard.writeText(value)
    return true
  } catch {
    // Embedded previews may deny Clipboard API access. Keep the documented
    // prompt copyable without requiring a secure browser context.
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }
}

/** Render one prompt with an explicit, accessible copy action. */
export function AgentPrompt({
  title = 'Copy and paste this prompt into your coding agent',
  copyOnly = false,
  children,
}: AgentPromptProps) {
  const [isCopied, setIsCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isCopied) return
    const timeout = window.setTimeout(() => setIsCopied(false), 1600)
    return () => window.clearTimeout(timeout)
  }, [isCopied])

  return (
    <section className="not-prose my-7 overflow-hidden rounded-xl border border-border bg-muted/20">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${
          copyOnly ? 'px-5 py-5' : 'border-b border-border px-4 py-3'
        }`}
      >
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-live="polite"
          onClick={() => {
            const value = contentRef.current?.innerText.trim() ?? ''
            if (!value) return
            void copyText(value).then((wasCopied) => {
              if (wasCopied) setIsCopied(true)
            })
          }}
        >
          {isCopied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {isCopied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      {copyOnly ? (
        <div
          ref={contentRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-[-10000px] top-0 w-[60rem] whitespace-normal"
        >
          {children}
        </div>
      ) : (
        <div
          ref={contentRef}
          className="max-h-[30rem] overflow-auto px-5 py-4 text-[0.9rem] leading-7 text-foreground/75 [&>ol]:my-3 [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:my-3 [&>ul]:my-3 [&>ul]:list-disc [&>ul]:pl-5"
        >
          {children}
        </div>
      )}
    </section>
  )
}
