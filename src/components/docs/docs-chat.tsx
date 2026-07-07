'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ArrowUp, Sparkles, Zap, Bot, Brain, Stars, Wand, Square, Maximize2, Minimize2, type LucideProps } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { DEFAULT_AI_DISCLAIMER } from '@/lib/ai-defaults'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

type IconName = 'sparkles' | 'zap' | 'bot' | 'brain' | 'stars' | 'wand'

const ICON_MAP: Record<IconName, React.ComponentType<LucideProps>> = {
  sparkles: Sparkles,
  zap: Zap,
  bot: Bot,
  brain: Brain,
  stars: Stars,
  wand: Wand,
}

function FabIcon({ icon, className }: { icon?: string; className?: string }) {
  // URL or path → render as image
  if (icon && (icon.startsWith('/') || icon.startsWith('http'))) {
    return <img src={icon} alt="" className={className} style={{ objectFit: 'contain' }} />
  }
  // Named icon → look up in map, fall back to Sparkles
  const Icon = ICON_MAP[(icon as IconName) ?? 'sparkles'] ?? Sparkles
  return <Icon className={className} />
}

const SUGGESTIONS = [
  'How do I get started?',
  'How does navigation work?',
  'How do I add an API reference?',
  'How do I enable the AI chat?',
]

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
        />
      ))}
    </span>
  )
}

interface DocsChatProps {
  label?: string
  icon?: string
  /** False when no Anthropic key is configured — show an upfront notice instead
   * of inviting a question that would 503. */
  enabled?: boolean
}

export function DocsChat({ label = 'Ask AI', icon, enabled = true }: DocsChatProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [chatShown, setChatShown] = useState(true)
  // Live admin overrides — SSR'd prop is the first-paint value; the chat-status
  // fetch swaps in the admin's custom name / disclaimer when set. Disclaimer
  // starts on its generic default so a safety notice always shows, even if the
  // fetch is slow or fails.
  const [liveLabel, setLiveLabel] = useState(label)
  const [disclaimer, setDisclaimer] = useState(DEFAULT_AI_DISCLAIMER)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [input])

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 60)
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  // Respect the admin's live enable/disable toggle (hide if off) and pick up the
  // admin's custom assistant name + disclaimer.
  useEffect(() => {
    let active = true
    fetch('/api/chat-status')
      .then((r) => (r.ok ? r.json() : { show: true }))
      .then((d) => {
        if (!active || !d) return
        if (d.show === false) setChatShown(false)
        if (typeof d.label === 'string' && d.label) setLiveLabel(d.label)
        if (typeof d.disclaimer === 'string') setDisclaimer(d.disclaimer)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMsg: Message = { role: 'user', content }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    const assistantMsg: Message = { role: 'assistant', content: '' }
    setMessages((prev) => [...prev, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const errText = await res.text()
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: errText || 'Something went wrong.' }
          return next
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = {
            role: 'assistant',
            content: next[next.length - 1].content + chunk,
          }
          return next
        })
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: 'Failed to connect. Please try again.' }
        return next
      })
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [input, loading, messages])

  // Lock the page's scroll while the panel is open so its own scrollbar isn't
  // shown next to the panel's (the "two scrollbars" issue). Pad by the scrollbar
  // width so hiding it doesn't shift the docs content underneath.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    const scrollbarWidth = window.innerWidth - root.clientWidth
    const prevOverflow = root.style.overflow
    const prevPad = document.body.style.paddingRight
    root.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      root.style.overflow = prevOverflow
      document.body.style.paddingRight = prevPad
    }
  }, [open])

  if (!chatShown) return null

  return (
    <>
      {/* FAB — opens the panel (hidden while open; the panel has its own close) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={`Open ${liveLabel}`}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-accent text-accent-foreground shadow-lg transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <FabIcon icon={icon} className="h-5 w-5" />
          <span className="text-[9px] font-semibold tracking-wide opacity-90">{liveLabel}</span>
        </button>
      )}

      {/* Panel — full-height right dock */}
      {open && (
        <div
          className="fixed inset-y-0 right-0 z-50 flex flex-col overflow-hidden border-l border-border shadow-2xl backdrop-blur-xl"
          style={{
            width: expanded ? 'min(680px, 100vw)' : 'min(420px, 100vw)',
            background: 'color-mix(in srgb, var(--background) 92%, transparent)',
            transition: 'width 0.2s var(--ds-ease-out, ease)',
          }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10">
                <FabIcon icon={icon} className="h-3.5 w-3.5 text-accent" />
              </div>
              <span className="text-sm font-semibold">{liveLabel}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Beta
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
                className="hidden h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-2">
            {messages.length === 0 ? (
              /* Welcome state */
              <div className="flex h-full flex-col items-center justify-center gap-6 pb-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
                    <FabIcon icon={icon} className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <p className="font-semibold">How can I help?</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ask anything about the documentation.
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6 py-2">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex min-w-0 gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10">
                        <FabIcon icon={icon} className="h-3 w-3 text-accent" />
                      </div>
                    )}

                    {msg.role === 'user' ? (
                      /* User bubble */
                      <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-muted px-4 py-2.5 text-sm leading-relaxed">
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {msg.content}
                        </span>
                      </div>
                    ) : (
                      /* Assistant — no bubble, full prose */
                      <div className="min-w-0 flex-1 text-sm leading-relaxed">
                        {msg.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none break-words
                            [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_:not(pre)>code]:break-words
                            prose-p:leading-relaxed prose-p:my-2 first:prose-p:mt-0
                            prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1
                            prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
                            prose-code:rounded prose-code:bg-zinc-100 prose-code:dark:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                            prose-pre:rounded-xl prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-800 prose-pre:text-zinc-800 prose-pre:dark:text-zinc-100 prose-pre:text-xs prose-pre:p-4
                            [&_pre]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:border-0 [&_pre_code]:text-inherit [&_pre_code]:rounded-none [&_pre_*]:!no-underline [&_pre_*]:!border-0 [&_pre_*]:!decoration-transparent [&_pre_*]:!shadow-none
                            prose-blockquote:border-l-accent/40 prose-blockquote:text-muted-foreground
                            [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                          >
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : loading && i === messages.length - 1 ? (
                          <TypingDots />
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 px-4 pb-4 pt-2">
            {!enabled ? (
              <p className="mb-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                AI chat is turned on but needs a key. Set <code className="font-mono">ANTHROPIC_API_KEY</code> in your
                environment to enable it.
              </p>
            ) : null}
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-muted/30 px-4 py-3 focus-within:border-accent/40 transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (enabled) void send()
                  }
                }}
                placeholder={enabled ? `Message ${liveLabel}…` : 'Add an ANTHROPIC_API_KEY to enable chat'}
                disabled={loading || !enabled}
                className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
                style={{ maxHeight: '160px' }}
              />
              <button
                onClick={loading ? stop : () => void send()}
                disabled={!loading && !input.trim()}
                aria-label={loading ? 'Stop' : 'Send'}
                className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-all disabled:opacity-30"
              >
                {loading
                  ? <Square className="h-3 w-3 fill-current" />
                  : <ArrowUp className="h-4 w-4" />
                }
              </button>
            </div>
            {disclaimer ? (
              <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground/70">
                {disclaimer}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
