'use client'

/** Documentation assistant dock; its scoped header offset follows wrapped navigation. */

import { useState, useRef, useEffect, useCallback } from 'react'
import NextImage from 'next/image'
import { SiteBrandMark } from '@/components/layout/site-brand-mark'
import { X, Maximize2, Minimize2, BookOpen, ChevronDown, ArrowUpRight, Paperclip } from 'lucide-react'
import { ChatComposer } from './docs-chat-composer'
import { ChatResponse, type ChatResponseStatus } from './docs-chat-response'
import { AI_CHAT_INTERRUPTED_MESSAGE, AI_CHAT_STREAM_CONTENT_TYPE, readAiChatResponse } from '@/lib/ai-chat-stream'
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
import {
  deriveFollowUpSuggestions,
  normalizeAiSuggestions,
} from '@/lib/ai-chat-suggestions'

interface Message {
  id: string
  status?: ChatResponseStatus
  error?: string
  role: 'user' | 'assistant'
  content: string
  sources?: Array<AiAnswerSource>
  citations?: Array<AiAnswerSource>
  /** Model-written next questions supplied with this answer, when available. */
  followUps?: Array<string>
  images?: Array<ChatImage>
}

interface ChatImage extends AiChatImage {
  id: string
  name: string
}

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

/**
 * Suggested questions. The list is always supplied by the caller — opening
 * questions from the site's navigation, follow-ups from the conversation — and
 * the block disappears entirely when there is nothing relevant to offer.
 */
export function SuggestionLinks({
  label,
  suggestions,
  onSelect,
}: {
  label: string
  suggestions: ReadonlyArray<string>
  onSelect: (suggestion: string) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <nav className="mt-6 border-t border-border/60 pt-4" aria-label={label}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-col items-start gap-1.5">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSelect(suggestion)}
            className="text-left text-sm text-accent transition-colors hover:text-foreground"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </nav>
  )
}

/** Compact evidence drawer shown before each grounded assistant answer. */
export function AnswerSources({ sources }: { sources: Array<AiAnswerSource> }) {
  if (sources.length === 0) return null
  const label = `Read ${sources.length} ${sources.length === 1 ? 'page' : 'pages'}`

  return (
    <details className="thally-docs-chat-sources group mb-3 border-b text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-border/60 py-1.5">
        {sources.map((source) => (
          <a
            key={source.url}
            href={source.url}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground"
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
  /** False when this deployment cannot currently answer questions. */
  enabled?: boolean
  /** Explains why this site cannot currently answer questions. */
  unavailableMessage?: string
  /** Status was already resolved by the lazy loader. */
  skipStatusCheck?: boolean
  /** Opening questions derived from this site's navigation by the status route. */
  starterSuggestions?: ReadonlyArray<string>
  /** Code-sample action awaiting display when this lazy panel mounts. */
  initialPrompt?: string | null
  /** Increments for each external request to open the chat panel. */
  openRequestId?: number
}

export function DocsChat({
  label = 'Ask AI',
  enabled = true,
  unavailableMessage = 'AI chat is unavailable. Try searching the documentation.',
  skipStatusCheck = false,
  starterSuggestions,
  initialPrompt,
  openRequestId,
}: DocsChatProps) {
  // Set only when this component resolves status itself; otherwise the lazy
  // loader's prop is the source, including when it arrives after mount.
  const [fetchedStarters, setFetchedStarters] = useState<Array<string> | null>(null)
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
  const [feedbackByMessage, setFeedbackByMessage] = useState<Record<string, 'up' | 'down' | null>>({})
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeRequestRef = useRef<{ id: string; controller: AbortController } | null>(null)
  const followsLatestRef = useRef(true)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => textareaRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort()
    activeRequestRef.current = null
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('thally-docs-ai-open', open && chatShown)
    root.classList.toggle('thally-docs-ai-expanded', open && chatShown && expanded)
    return () => {
      root.classList.remove('thally-docs-ai-open', 'thally-docs-ai-expanded')
    }
  }, [chatShown, expanded, open])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  useEffect(() => {
    if (!openRequestId) return
    if (initialPrompt) setInput(initialPrompt)
    setOpen(true)
  }, [initialPrompt, openRequestId])

  useEffect(() => {
    if (followsLatestRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages, loading])

  const stop = useCallback(() => {
    const active = activeRequestRef.current
    if (!active) return
    activeRequestRef.current = null
    active.controller.abort()
    setMessages((current) => current.map((message) => message.id === active.id ? { ...message, status: 'stopped' } : message))
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
      .then((r) => (r.ok ? r.json() : { show: false }))
      .then((d) => {
        if (!active || !d) return
        setChatShown(d.show === true)
        if (typeof d.label === 'string' && d.label) setLiveLabel(d.label)
        if (typeof d.disclaimer === 'string') setDisclaimer(d.disclaimer)
        setFetchedStarters(normalizeAiSuggestions(d.suggestions))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [skipStatusCheck])

  const send = useCallback(async (text?: string, retry?: { question: Message; history: Array<Message> }) => {
    const typedContent = (retry?.question.content ?? text ?? input).trim()
    const images = retry?.question.images ?? pendingImages
    if (!enabled || !chatShown || (!typedContent && images.length === 0) || activeRequestRef.current) return

    const content = typedContent || (images.length === 1 ? 'What should I know about this screenshot?' : 'What should I know about these screenshots?')
    const userMsg: Message = { id: screenshotId(), role: 'user', content, images }
    const assistantMsg: Message = { id: screenshotId(), role: 'assistant', content: '', sources: [], status: 'streaming' }
    const controller = new AbortController()
    const active = { id: assistantMsg.id, controller }
    activeRequestRef.current = active
    followsLatestRef.current = true
    setMessages((current) => [...current, userMsg, assistantMsg])
    // Regeneration owns the original question and screenshots. A separately
    // drafted next question must never be consumed by the retry action.
    if (!retry) {
      setInput('')
      setPendingImages([])
      setAttachmentError('')
    }
    setLoading(true)
    const updateAnswer = (change: Partial<Message>) => {
      if (activeRequestRef.current !== active) return
      setMessages((current) => current.map((message) => message.id === active.id ? { ...message, ...change } : message))
    }

    try {
      const history = (retry?.history ?? messages).filter((message) => message.role === 'user' || !message.status || message.status === 'done')
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: AI_CHAT_STREAM_CONTENT_TYPE },
        body: JSON.stringify({ messages: createAiChatRequestMessages([...history, userMsg]) }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const error = (await res.text()).trim().slice(0, 500)
        updateAnswer({ status: 'error', error: error || 'Something went wrong. Please try again.' })
        return
      }
      updateAnswer({ sources: parseAiAnswerSources(res.headers.get(AI_ANSWER_SOURCES_HEADER)) })
      await readAiChatResponse(res, (event) => {
        if (event.type === 'answer') updateAnswer({ content: event.text, citations: event.citations })
        else if (event.type === 'done') updateAnswer({ content: event.text, citations: event.citations, followUps: event.followUps, status: 'done' })
        else updateAnswer({ status: 'error', error: event.message })
      }, controller.signal)
    } catch (error) {
      if (activeRequestRef.current !== active) return
      updateAnswer({ status: controller.signal.aborted ? 'stopped' : 'error', error: error instanceof Error && error.message === AI_CHAT_INTERRUPTED_MESSAGE ? error.message : 'Failed to connect. Please try again.' })
    } finally {
      // The stopped request can finish after a new question has begun. It may
      // neither clear that request's controller nor change its loading state.
      if (activeRequestRef.current === active) {
        activeRequestRef.current = null
        setLoading(false)
      }
    }
  }, [chatShown, enabled, input, messages, pendingImages])

  if (!chatShown) return null

  const starters = fetchedStarters ?? normalizeAiSuggestions(starterSuggestions ?? [])
  // Follow-ups belong to the latest finished answer. Prefer the questions the
  // answer service wrote for this conversation; otherwise derive them from the
  // pages retrieved for the latest question, which already track the topic.
  const latest = messages[messages.length - 1]
  const followUps = !loading && latest?.role === 'assistant' && latest.status === 'done' && latest.content
    ? latest.followUps?.length
      ? latest.followUps
      : deriveFollowUpSuggestions({
          sources: latest.sources ?? [],
          asked: messages.filter((message) => message.role === 'user').map((message) => message.content),
        })
    : []

  return open ? (
    <>
      {/* The dock starts below the shared top bar so navigation stays usable. */}
      <aside
          className="thally-docs-chat-panel fixed bottom-0 right-0 top-[var(--docs-header-height,60px)] z-[60] flex flex-col overflow-hidden border-l border-border motion-reduce:!transition-none"
          aria-label={liveLabel}
          style={{
            width: expanded ? 'min(680px, 100vw)' : 'min(420px, 100vw)',
            transition: 'width 0.2s var(--ds-ease-out, ease)',
          }}
        >
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 px-5">
            <div className="flex items-center gap-2.5">
              <SiteBrandMark size={20} className="thally-docs-chat-brand h-5 w-5" />
              <span className="text-sm font-semibold">{liveLabel}</span>
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
          {disclaimer ? (
            <p className="shrink-0 border-b border-border/60 px-5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {disclaimer}
            </p>
          ) : null}

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden px-5 pb-2 pt-6"
            onScroll={(event) => {
              const element = event.currentTarget
              followsLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 72
            }}
          >
            {messages.length === 0 ? (
              /* Welcome state */
              <div className="flex h-full flex-col items-center justify-center gap-6 pb-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  <SiteBrandMark size={32} className="thally-docs-chat-brand h-8 w-8" />
                  <div>
                    <p className="font-semibold">How can I help?</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ask anything about the documentation.
                    </p>
                  </div>
                </div>
                <SuggestionLinks label="Suggestions" suggestions={starters} onSelect={(suggestion) => void send(suggestion)} />
              </div>
            ) : (
              <div className="flex flex-col gap-[22px]">
                {messages.map((msg, i) => (
                  <div key={msg.id} className={`flex min-w-0 gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <SiteBrandMark className="thally-docs-chat-brand mt-0.5 h-6 w-6 shrink-0" />
                    )}

                    {msg.role === 'user' ? (
                      /* User bubble */
                      <div className="thally-docs-chat-user">
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
                        <p className="thally-docs-chat-question">{msg.content}</p>
                      </div>
                    ) : (
                      /* Assistant — no bubble, full prose */
                      <div className="min-w-0 flex-1 text-sm leading-relaxed">
                        <AnswerSources sources={msg.sources ?? []} />
                        <ChatResponse
                          text={msg.content}
                          status={msg.status ?? 'done'}
                          error={msg.error}
                          sources={msg.citations ?? msg.sources ?? []}
                          feedback={feedbackByMessage[msg.id] ?? null}
                          onFeedback={(feedback) => setFeedbackByMessage((current) => ({ ...current, [msg.id]: feedback }))}
                          isRetryDisabled={loading || !enabled}
                          onRetry={() => {
                            const questionIndex = messages.slice(0, i).findLastIndex((message) => message.role === 'user')
                            if (questionIndex >= 0) void send(undefined, { question: messages[questionIndex], history: messages.slice(0, questionIndex) })
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <SuggestionLinks label="Follow-ups" suggestions={followUps} onSelect={(suggestion) => void send(suggestion)} />
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 px-4 pb-4 pt-2">
            {!enabled ? (
              <p className="mb-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {unavailableMessage}
              </p>
            ) : null}
            <ChatComposer
              value={input}
              onValueChange={setInput}
              onSubmit={(value) => void send(value)}
              onStop={stop}
              isLoading={loading}
              isEnabled={enabled}
              hasAttachments={pendingImages.length > 0}
              label={liveLabel}
              inputRef={textareaRef}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.items)
                  .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
                  .flatMap((item) => { const file = item.getAsFile(); return file ? [file] : [] })
                if (files.length > 0) void addScreenshots(files)
              }}
              attachments={<>
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
              </>}
              attachmentAction={
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || !enabled || pendingImages.length >= MAX_AI_CHAT_IMAGES}
                  aria-label="Attach screenshots"
                  title="Attach or paste screenshots"
                  className="thally-docs-chat-attach -ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                ><Paperclip className="h-4 w-4" aria-hidden="true" /></button>
              }
            />
          </div>
      </aside>
    </>
  ) : null
}
