'use client'

import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { MutedPanel, Panel } from '@/components/layout/sections'

interface FeedbackProps {
  endpoint?: string
}

export function Feedback({ endpoint }: FeedbackProps) {
  const pathname = usePathname()
  const [state, setState] = useState<'idle' | 'submitting' | 'recorded'>('idle')

  async function vote(value: 'yes' | 'no') {
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

  if (state === 'recorded') {
    return (
      <MutedPanel className="text-sm text-foreground/80">
        Thanks for the feedback — we review every submission weekly.
      </MutedPanel>
    )
  }

  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-foreground/80">Was this page helpful?</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => vote('yes')}>
          <ThumbsUp className="mr-1.5 h-4 w-4" />
          Yes
        </Button>
        <Button variant="outline" size="sm" disabled={state === 'submitting'} onClick={() => vote('no')}>
          <ThumbsDown className="mr-1.5 h-4 w-4" />
          No
        </Button>
      </div>
    </Panel>
  )
}
