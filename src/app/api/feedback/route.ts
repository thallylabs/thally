/** Public page-feedback ingestion and analytics forwarding. */

import { NextResponse } from 'next/server'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

/**
 * POST /api/feedback
 *
 * Receives page feedback votes from the Feedback component.
 * Body: { page: string, vote: "yes" | "no", url: string, message?, followUp? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { page, vote, url, message, followUp, visitorType } = body as {
      page?: string
      vote?: string
      url?: string
      message?: string
      followUp?: boolean
      visitorType?: 'human' | 'agent'
    }

    if (!page || (vote !== 'yes' && vote !== 'no')) {
      return NextResponse.json({ error: 'Missing or invalid page rating' }, { status: 400 })
    }
    const isFollowUp = followUp === true
    const normalizedMessage = typeof message === 'string' ? message.trim().slice(0, 500) : undefined
    if (isFollowUp && (vote !== 'no' || !normalizedMessage)) {
      return NextResponse.json({ error: 'Invalid feedback follow-up' }, { status: 400 })
    }

    const origin = new URL(request.url).origin
    const cloud = await getCloudSiteConfig(origin)
    const feedback = cloud?.siteConfig.portable.feedback
    if (cloud) {
      if (visitorType === 'agent' && !feedback?.agentFeedback) {
        return NextResponse.json({ error: 'Agent feedback is disabled.' }, { status: 403 })
      }
      if (visitorType !== 'agent' && !feedback?.thumbsRating) {
        return NextResponse.json({ error: 'Page feedback is disabled.' }, { status: 403 })
      }
      if (normalizedMessage && !feedback?.pageFeedback) {
        return NextResponse.json({ error: 'Written feedback is disabled.' }, { status: 403 })
      }
    }

    try {
      await recordAnalyticsEvent({
        type: 'feedback',
        // A written follow-up is its own event but not another rating. Keeping
        // the vote out of analytics prevents one reader from being counted twice.
        path: page,
        page,
        referer: url,
        vote: isFollowUp ? undefined : vote,
        message: normalizedMessage,
        visitorType: visitorType ?? 'human',
      })
    } catch (error) {
      // Never let an analytics write failure break the user's request.
      console.error('feedback: failed to record analytics event', error)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
