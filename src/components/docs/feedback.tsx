'use client'

/** Reader-facing page ratings and optional negative-feedback follow-ups. */

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

type FeedbackVote = 'yes' | 'no'
type FeedbackRequestState = 'idle' | 'submitting' | 'recorded'
type FeedbackMessageState = 'idle' | 'submitting' | 'sent'

/** Keep the written prompt exclusive to an unresolved negative rating. */
export function shouldShowFeedbackMessage(
  vote: FeedbackVote | null,
  isWrittenFeedbackEnabled: boolean,
  messageState: FeedbackMessageState,
): boolean {
  return vote === 'no' && isWrittenFeedbackEnabled && messageState !== 'sent'
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
  const [state, setState] = useState<FeedbackRequestState>('idle')
  const [voteValue, setVoteValue] = useState<FeedbackVote | null>(null)
  const [message, setMessage] = useState('')
  const [messageState, setMessageState] = useState<FeedbackMessageState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function sendFeedback(payload: Record<string, unknown>) {
    // An empty endpoint intentionally preserves the zero-backend demo path.
    if (!endpoint) return
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`Feedback endpoint returned ${response.status}`)
  }

  async function vote(value: FeedbackVote) {
    setVoteValue(value)
    setState('submitting')
    setErrorMessage('')
    try {
      await sendFeedback({ page: pathname, vote: value, url: window.location.href })
      setState('recorded')
    } catch {
      setVoteValue(null)
      setState('idle')
      setErrorMessage("We couldn't send your feedback. Check your connection and try again.")
    }
  }

  async function submitMessage() {
    const normalizedMessage = message.trim()
    if (voteValue !== 'no' || !normalizedMessage) return
    setMessageState('submitting')
    setErrorMessage('')
    try {
      await sendFeedback({
        page: pathname,
        vote: voteValue,
        message: normalizedMessage,
        followUp: true,
        url: window.location.href,
      })
      setMessage('')
      setMessageState('sent')
    } catch {
      setMessageState('idle')
      setErrorMessage("We couldn't send your note. Check your connection and try again.")
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
  const isMessageVisible = shouldShowFeedbackMessage(voteValue, pageFeedback, messageState)

  if (state === 'recorded') {
    return (
      <MutedPanel className="space-y-3 text-sm text-foreground/80">
        <p role="status">
          {messageState === 'sent' ? 'Thanks — your note was sent.' : 'Thanks for the feedback.'}
        </p>
        {isMessageVisible ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void submitMessage()
            }}
          >
            <label className="sr-only" htmlFor="page-feedback-message">Tell us more</label>
            <input
              id="page-feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              disabled={messageState === 'submitting'}
              placeholder="Tell us what could be clearer"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!message.trim() || messageState === 'submitting'}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {messageState === 'submitting' ? 'Sending…' : 'Send note'}
            </Button>
          </form>
        ) : null}
        {errorMessage ? <p className="text-destructive" role="alert">{errorMessage}</p> : null}
      </MutedPanel>
    )
  }

  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {thumbsRating ? (
        <>
          <div>
            <p className="text-sm font-medium text-foreground/80">Was this page helpful?</p>
            {errorMessage ? (
              <p className="mt-1 text-sm text-destructive" role="alert">{errorMessage}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => void vote('yes')}>
              <ThumbsUp className="mr-1.5 h-4 w-4" />
              Yes
            </Button>
            <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => void vote('no')}>
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
