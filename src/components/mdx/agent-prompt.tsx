'use client'

/**
 * Copyable, agent-ready instructions for task-focused documentation guides.
 * The instruction payload stays out of the visual and accessibility trees;
 * readers reveal it only by choosing the explicit copy action.
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
            const value = contentRef.current
              ? promptText(contentRef.current)
              : ''
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
