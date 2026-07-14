'use client'

import { AlertCircle, Pencil, Send, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { MutedPanel, Panel } from '@/components/layout/sections'

interface FeedbackProps {
  endpoint?: string
  pageId?: string
  repoUrl?: string
  thumbsRating?: boolean
  pageFeedback?: boolean
  editSuggestions?: boolean
  issueReporting?: boolean
}

export function Feedback({
  endpoint = '/api/feedback',
  pageId,
  repoUrl,
  thumbsRating = true,
  pageFeedback = false,
  editSuggestions = false,
  issueReporting = false,
}: FeedbackProps) {
  const pathname = usePathname()
  const [state, setState] = useState<'idle' | 'submitting' | 'recorded'>('idle')
  const [voteValue, setVoteValue] = useState<'yes' | 'no' | null>(null)
  const [message, setMessage] = useState('')

  async function vote(value: 'yes' | 'no') {
    setVoteValue(value)
    setState('submitting')
    if (endpoint) {
      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: pathname, vote: value, url: window.location.href }),
        })
      } catch {
        // Silently ignore network errors — still show the thank-you message
      }
    }
    setState('recorded')
  }

  async function submitMessage() {
    if (!voteValue || !message.trim()) return
    setState('submitting')
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: pathname,
          vote: voteValue,
          message: message.trim(),
          url: window.location.href,
        }),
      })
      setMessage('')
    } finally {
      setState('recorded')
    }
  }

  const normalizedRepo = repoUrl?.replace(/\/$/, '')
  const editUrl =
    editSuggestions && normalizedRepo && pageId
      ? `${normalizedRepo}/edit/main/src/content/${pageId}.mdx`
      : null
  const issueUrl = issueReporting && normalizedRepo
    ? `${normalizedRepo}/issues/new?title=${encodeURIComponent(`Docs feedback: ${pathname}`)}`
    : null

  if (state === 'recorded') {
    return (
      <MutedPanel className="space-y-3 text-sm text-foreground/80">
        <p>Thanks for the feedback.</p>
        {pageFeedback ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="page-feedback-message">Tell us more</label>
            <input
              id="page-feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              placeholder="Tell us what could be clearer"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" disabled={!message.trim()} onClick={submitMessage}>
              <Send className="mr-1.5 h-4 w-4" />
              Send note
            </Button>
          </div>
        ) : null}
      </MutedPanel>
    )
  }

  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {thumbsRating ? (
        <>
          <p className="text-sm font-medium text-foreground/80">Was this page helpful?</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => vote('yes')}>
              <ThumbsUp className="mr-1.5 h-4 w-4" />
              Yes
            </Button>
            <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => vote('no')}>
              <ThumbsDown className="mr-1.5 h-4 w-4" />
              No
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm font-medium text-foreground/80">Help us improve this page</p>
      )}
      <div className="flex flex-wrap gap-2">
        {editUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a href={editUrl} target="_blank" rel="noreferrer"><Pencil className="mr-1.5 h-4 w-4" />Suggest an edit</a>
          </Button>
        ) : null}
        {issueUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a href={issueUrl} target="_blank" rel="noreferrer"><AlertCircle className="mr-1.5 h-4 w-4" />Report an issue</a>
          </Button>
        ) : null}
      </div>
    </Panel>
  )
}
