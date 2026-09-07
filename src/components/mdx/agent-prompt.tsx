'use client'

/**
 * Copyable, agent-ready instructions for task-focused documentation guides.
 * The instruction payload stays out of the visual and accessibility trees;
 * readers reveal it only by choosing the explicit copy action.
 */
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface AgentPromptProps {
  heading?: string
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

/** Preserve paragraph and list structure while reading a hidden MDX payload. */
function promptText(root: HTMLDivElement): string {
  return Array.from(root.childNodes)
    .map((node) => {
      if (node.nodeType === 3) return node.textContent?.trim() ?? ''

      const element = node as HTMLElement
      if (element.tagName === 'OL' || element.tagName === 'UL') {
        const isOrdered = element.tagName === 'OL'
        return Array.from(element.children)
          .map((item, index) => {
            const marker = isOrdered ? `${index + 1}.` : '-'
            return `${marker} ${item.textContent?.trim() ?? ''}`
          })
          .join('\n')
      }

      return element.textContent?.trim() ?? ''
    })
    .filter(Boolean)
    .join('\n\n')
}

/** Render one prompt with an explicit, accessible copy action. */
export function AgentPrompt({
  heading = 'Prefer to let an agent do it?',
  title = 'Copy and paste this prompt into your coding agent',
  copyOnly = true,
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
        className={`flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center ${
          copyOnly ? 'px-[18px] py-4' : 'border-b border-border px-[18px] py-4'
        }`}
      >
        <p className="text-[0.94rem] leading-6 text-foreground/75">
          <strong className="block font-medium text-foreground">{heading}</strong>
          <span>{title}</span>
        </p>
        <button
          type="button"
          className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[0.82rem] font-medium text-foreground/80 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-live="polite"
          onClick={() => {
            const value = contentRef.current
              ? promptText(contentRef.current)
              : ''
            if (!value) return
            void copyText(value).then((wasCopied) => {
              if (wasCopied) setIsCopied(true)
            })
          }}
        >
          {isCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {isCopied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      {copyOnly ? (
        <div
          ref={contentRef}
          hidden
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
