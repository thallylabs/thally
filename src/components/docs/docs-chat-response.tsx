'use client'

/**
 * Progressive assistant prose and per-answer actions. Each update renders the
 * received snapshot immediately; Markdown cannot execute HTML, fetch images,
 * or activate a citation that is absent from the retrieved evidence.
 */

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { aiAnswerLink } from '@/lib/ai-answer-links'
import type { AiAnswerSource } from '@/lib/ai-answer-sources'
import styles from './docs-chat-response.module.css'

export type ChatResponseStatus = 'streaming' | 'done' | 'stopped' | 'error'

interface ChatResponseProps {
  text: string
  status: ChatResponseStatus
  error?: string
  sources: ReadonlyArray<AiAnswerSource>
  onRetry: () => void
  isRetryDisabled: boolean
  feedback?: 'up' | 'down' | null
  onFeedback?: (feedback: 'up' | 'down' | null) => void
}

/** Retain partial text after cancellation or a failed stream so it can be copied. */
export function ChatResponse({ text, status, error, sources, onRetry, isRetryDisabled, feedback = null, onFeedback }: ChatResponseProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1600)
    } catch { setCopied(false) }
  }
  const isStreaming = status === 'streaming'
  return (
    <div data-slot="chat-response" data-status={status} aria-busy={isStreaming}>
      {text ? <div className={`${styles.prose} prose prose-sm dark:prose-invert max-w-none break-words
        [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_:not(pre)>code]:break-words
        [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto
        prose-p:leading-relaxed prose-p:my-2 first:prose-p:mt-0
        prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-1
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
        prose-code:rounded prose-code:bg-zinc-100 prose-code:dark:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:rounded-xl prose-pre:bg-zinc-100 prose-pre:dark:bg-zinc-800 prose-pre:text-zinc-800 prose-pre:dark:text-zinc-100 prose-pre:text-xs prose-pre:p-4
        [&_pre]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:border-0 [&_pre_code]:text-inherit [&_pre_code]:rounded-none [&_pre_*]:!no-underline [&_pre_*]:!border-0 [&_pre_*]:!decoration-transparent [&_pre_*]:!shadow-none
        prose-blockquote:border-l-accent/40 prose-blockquote:text-muted-foreground
        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0`}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => aiAnswerLink(url, sources, typeof window === 'undefined' ? undefined : window.location.origin) ?? ''}
          components={{
            a: ({ href, children }) => href ? <a href={href}>{children}</a> : <span>{children}</span>,
            img: ({ alt }) => <span>{alt ?? ''}</span>,
          }}
        >{text}</ReactMarkdown>
      </div> : null}
      {isStreaming ? <span className="inline-flex items-center gap-2 py-1 text-xs text-muted-foreground" role="status"><span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" /><span className={text ? 'sr-only' : undefined}>Writing response…</span></span> : null}
      {status === 'stopped' ? <p className="mt-2 text-xs text-muted-foreground" role="status">Response stopped. This request may still use AI Credits.</p> : null}
      {status === 'error' ? <p className="mt-2 text-xs text-destructive" role="status">{error || 'The response was interrupted. Please try again.'}</p> : null}
      {!isStreaming ? <div className="thally-docs-chat-feedback -ml-1 mt-2 flex items-center gap-0.5" aria-label="Answer actions">
        {text ? <>
          <button type="button" onClick={() => void copy()} aria-label={copied ? 'Copied response' : 'Copy response'} title={copied ? 'Copied response' : 'Copy response'} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}</button>
          <button type="button" onClick={() => onFeedback?.(feedback === 'up' ? null : 'up')} aria-label="Helpful response" title="Helpful response" aria-pressed={feedback === 'up'} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" /></button>
          <button type="button" onClick={() => onFeedback?.(feedback === 'down' ? null : 'down')} aria-label="Unhelpful response" title="Unhelpful response" aria-pressed={feedback === 'down'} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </> : null}
        <button type="button" onClick={onRetry} disabled={isRetryDisabled} aria-label="Regenerate response" title="Regenerate response" className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /></button>
      </div> : null}
    </div>
  )
}
