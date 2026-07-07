'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Sparkles } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function markdownPath(pathname: string): string {
  // The root path (/) maps to introduction.mdx
  return pathname === '/' ? '/introduction.md' : `${pathname}.md`
}

function llmPrompt(absoluteMdUrl: string): string {
  return `Read ${absoluteMdUrl} and help me with questions about this page.`
}

interface HandoffItem {
  label: string
  icon: ReactNode
  href: (mdUrl: string) => string
}

const HANDOFFS: Array<HandoffItem> = [
  {
    label: 'Open in ChatGPT',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    href: (u) => `https://chatgpt.com/?q=${encodeURIComponent(llmPrompt(u))}`,
  },
  {
    label: 'Open in Claude',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    href: (u) => `https://claude.ai/new?q=${encodeURIComponent(llmPrompt(u))}`,
  },
  {
    label: 'Open in Perplexity',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    href: (u) => `https://www.perplexity.ai/search?q=${encodeURIComponent(llmPrompt(u))}`,
  },
]

export function CopyPageButton() {
  const pathname = usePathname()
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleCopy() {
    try {
      const res = await fetch(markdownPath(pathname))
      if (!res.ok) return
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable (e.g. non-secure context) — fail silently
    }
  }

  function absoluteMdUrl(): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    return `${origin}${markdownPath(pathname)}`
  }

  function handoff(item: HandoffItem) {
    window.open(item.href(absoluteMdUrl()), '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="gap-1.5 rounded-r-none pr-2 text-xs text-muted-foreground hover:text-foreground"
        aria-label="Copy page as markdown"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied!' : 'Copy page'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="rounded-l-none border-l border-border/50 px-1.5 text-muted-foreground hover:text-foreground"
        aria-label="More page actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-background p-1 shadow-lg"
        >
          <a
            href={markdownPath(pathname)}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-foreground/80 transition hover:bg-muted/60 hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" /> View as Markdown
          </a>
          <div className="my-1 h-px bg-border/60" />
          {HANDOFFS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => handoff(item)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-foreground/80 transition hover:bg-muted/60 hover:text-foreground"
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              <ExternalLink className="h-3 w-3 text-foreground/40" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
