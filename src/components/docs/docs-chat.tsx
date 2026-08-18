'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import NextImage from 'next/image'
import { X, ArrowUp, Sparkles, Zap, Bot, Brain, Stars, Wand, Square, Maximize2, Minimize2, BookOpen, ChevronDown, ArrowUpRight, Paperclip, type LucideProps } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { DEFAULT_AI_DISCLAIMER } from '@/lib/ai-defaults'
import {
  MAX_AI_CHAT_IMAGES,
  MAX_AI_CHAT_IMAGE_BYTES,
  createAiChatRequestMessages,
  isAiChatImageMediaType,
  type AiChatImage,
} from '@/lib/ai-chat-messages'
import {
  AI_ANSWER_SOURCES_HEADER,
  parseAiAnswerSources,
  type AiAnswerSource,
} from '@/lib/ai-answer-sources'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Array<AiAnswerSource>
  images?: Array<ChatImage>
}

interface ChatImage extends AiChatImage {
  id: string
  name: string
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

const SCREENSHOT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'

function screenshotSrc(image: AiChatImage): string {
  return `data:${image.mediaType};base64,${image.data}`
}

function screenshotId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `screenshot-${Date.now()}-${Math.random()}`
}

function readScreenshot(file: File): Promise<ChatImage> {
  const mediaType = file.type
  if (!isAiChatImageMediaType(mediaType)) {
    return Promise.reject(new Error('Use a PNG, JPEG, GIF, or WebP image.'))
  }
  if (file.size > MAX_AI_CHAT_IMAGE_BYTES) {
    return Promise.reject(new Error('Each screenshot must be 3 MB or smaller.'))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('This screenshot could not be read.'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const marker = ';base64,'
      const markerIndex = result.indexOf(marker)
      if (markerIndex < 0) {
        reject(new Error('This screenshot could not be read.'))
        return
      }
      resolve({
        id: screenshotId(),
        name: file.name || 'Pasted screenshot',
        mediaType,
        data: result.slice(markerIndex + marker.length),
      })
    }
    reader.readAsDataURL(file)
  })
}

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

/** Compact evidence drawer shown before each grounded assistant answer. */
export function AnswerSources({ sources }: { sources: Array<AiAnswerSource> }) {
  if (sources.length === 0) return null
  const label = `Read ${sources.length} ${sources.length === 1 ? 'page' : 'pages'}`

  return (
    <details className="group mb-3 overflow-hidden rounded-xl border border-border/70 bg-muted/25 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border/60 p-1.5">
        {sources.map((source) => (
          <a
            key={source.url}
            href={source.url}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground no-underline transition-colors hover:bg-background/80 hover:text-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{source.title}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </a>
        ))}
      </div>
    </details>
  )
}

interface DocsChatProps {
  label?: string
  icon?: string
  /** False when no Anthropic key is configured — show an upfront notice instead
   * of inviting a question that would 503. */
  enabled?: boolean
  /** Status was already resolved by the lazy loader. */
  skipStatusCheck?: boolean
}

export function DocsChat({
  label = 'Ask AI',
  icon,
  enabled = true,
  skipStatusCheck = false,
}: DocsChatProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Keep the optional widget out of first paint. The tiny status endpoint is
  // deliberately separate so live admin toggles do not make docs pages
  // dynamic or delay navigation.
  const [chatShown, setChatShown] = useState(skipStatusCheck)
  // Live admin overrides — SSR'd prop is the first-paint value; the chat-status
  // fetch swaps in the admin's custom name / disclaimer when set. Disclaimer
  // starts on its generic default so a safety notice always shows, even if the
  // fetch is slow or fails.
  const [liveLabel, setLiveLabel] = useState(label)
  const [disclaimer, setDisclaimer] = useState(DEFAULT_AI_DISCLAIMER)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<Array<ChatImage>>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  // Code-block actions use one document-level contract so every renderer can
  // open the configured assistant without coupling MDX to this panel.
  useEffect(() => {
    function handleAskAssistant(event: Event) {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt
      if (prompt) setInput(prompt)
      setOpen(true)
    }
    window.addEventListener('thally:ask-assistant', handleAskAssistant)
    return () => window.removeEventListener('thally:ask-assistant', handleAskAssistant)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setLoading(false)
  }, [])

  const addScreenshots = useCallback(async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return
    const availableSlots = MAX_AI_CHAT_IMAGES - pendingImages.length
    if (availableSlots <= 0) {
      setAttachmentError(`You can attach up to ${MAX_AI_CHAT_IMAGES} screenshots.`)
      return
    }
    if (files.length > availableSlots) {
      setAttachmentError(`You can attach up to ${MAX_AI_CHAT_IMAGES} screenshots.`)
    } else {
      setAttachmentError('')
    }

    const selected = files.slice(0, availableSlots)
    const results = await Promise.allSettled(selected.map(readScreenshot))
    const images = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      setAttachmentError(
        failure.reason instanceof Error
          ? failure.reason.message
          : 'This screenshot could not be attached.',
      )
    }
    if (images.length > 0) {
      setPendingImages((current) => [...current, ...images].slice(0, MAX_AI_CHAT_IMAGES))
    }
  }, [pendingImages.length])

  const removeScreenshot = useCallback((id: string) => {
    setPendingImages((current) => current.filter((image) => image.id !== id))
    setAttachmentError('')
  }, [])

  // Respect the admin's live enable/disable toggle (hide if off) and pick up the
  // admin's custom assistant name + disclaimer.
  useEffect(() => {
    if (skipStatusCheck) return
    let active = true
    fetch('/api/chat-status')
      .then((r) => (r.ok ? r.json() : { show: true }))
      .then((d) => {
        if (!active || !d) return
        setChatShown(d.show === true)
        if (typeof d.label === 'string' && d.label) setLiveLabel(d.label)
        if (typeof d.disclaimer === 'string') setDisclaimer(d.disclaimer)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [skipStatusCheck])

  const send = useCallback(async (text?: string) => {
    const typedContent = (text ?? input).trim()
    if ((!typedContent && pendingImages.length === 0) || loading) return

    const images = pendingImages
    const content = typedContent || (
      images.length === 1
        ? 'What should I know about this screenshot?'
        : 'What should I know about these screenshots?'
    )

    const userMsg: Message = { role: 'user', content, images }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setPendingImages([])
    setAttachmentError('')
    setLoading(true)

    const assistantMsg: Message = { role: 'assistant', content: '', sources: [] }
    setMessages((prev) => [...prev, assistantMsg])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: createAiChatRequestMessages([...messages, userMsg]),
        }),
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

      const sources = parseAiAnswerSources(
        res.headers.get(AI_ANSWER_SOURCES_HEADER),
      )
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { ...next[next.length - 1], sources }
        return next
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = {
            ...next[next.length - 1],
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
  }, [input, loading, messages, pendingImages])

  if (!chatShown) return null

  return (
    <>
      {/* FAB — opens the panel (hidden while open; the panel has its own close) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={`Open ${liveLabel}`}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                      <div className="max-w-[78%] overflow-hidden rounded-2xl rounded-br-sm bg-muted text-sm leading-relaxed">
                        {msg.images?.length ? (
                          <div className={`grid gap-1.5 p-1.5 pb-0 ${msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                            {msg.images.map((image) => (
                              <NextImage
                                key={image.id}
                                src={screenshotSrc(image)}
                                alt={image.name}
                                width={280}
                                height={180}
                                unoptimized
                                className="max-h-44 w-full rounded-xl object-cover object-top"
                              />
                            ))}
                          </div>
                        ) : null}
                        <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          <span className="block px-4 py-2.5">{msg.content}</span>
                        </span>
                      </div>
                    ) : (
                      /* Assistant — no bubble, full prose */
                      <div className="min-w-0 flex-1 text-sm leading-relaxed">
                        <AnswerSources sources={msg.sources ?? []} />
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
            <div className="rounded-2xl border border-border bg-muted/30 p-2 transition-colors focus-within:border-accent/40">
              {pendingImages.length > 0 ? (
                <div className="mb-1.5">
                  <div className="flex gap-2 overflow-x-auto px-1 pt-1">
                    {pendingImages.map((image) => (
                      <div
                        key={image.id}
                        className="group/image relative h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-background"
                      >
                        <NextImage
                          src={screenshotSrc(image)}
                          alt={image.name}
                          width={80}
                          height={56}
                          unoptimized
                          className="h-full w-full object-cover object-top"
                        />
                        <button
                          type="button"
                          onClick={() => removeScreenshot(image.id)}
                          aria-label={`Remove ${image.name}`}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground opacity-80 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="px-2 pt-1.5 text-[10px] text-muted-foreground">
                    Screenshots are sent with this chat and not saved by Thally.
                  </p>
                </div>
              ) : null}
              {attachmentError ? (
                <p className="px-2 pb-1 text-[11px] text-destructive" role="status">
                  {attachmentError}
                </p>
              ) : null}
              <div className="flex items-end gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SCREENSHOT_ACCEPT}
                  multiple
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => {
                    void addScreenshots(Array.from(event.target.files ?? []))
                    event.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || !enabled || pendingImages.length >= MAX_AI_CHAT_IMAGES}
                  aria-label="Attach screenshots"
                  title="Attach screenshots"
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-35"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.items)
                      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                      .flatMap((item) => {
                        const file = item.getAsFile()
                        return file ? [file] : []
                      })
                    if (files.length > 0) void addScreenshots(files)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (enabled) void send()
                    }
                  }}
                  placeholder={enabled ? `Message ${liveLabel} or paste a screenshot…` : 'Add an ANTHROPIC_API_KEY to enable chat'}
                  disabled={loading || !enabled}
                  className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
                  style={{ maxHeight: '160px' }}
                />
                <button
                  type="button"
                  onClick={loading ? stop : () => void send()}
                  disabled={!loading && !input.trim() && pendingImages.length === 0}
                  aria-label={loading ? 'Stop' : 'Send'}
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all disabled:opacity-30"
                >
                  {loading
                    ? <Square className="h-3 w-3 fill-current" />
                    : <ArrowUp className="h-4 w-4" />
                  }
                </button>
              </div>
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
