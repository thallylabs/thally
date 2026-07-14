import { NextResponse } from 'next/server'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'
import { getCloudSiteConfig } from '@/lib/cloud-link/client'

/**
 * POST /api/feedback
 *
 * Receives page feedback votes from the Feedback component.
 * Body: { page: string, vote: "yes" | "no", url: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { page, vote, url, message, visitorType } = body as {
      page?: string
      vote?: string
      url?: string
      message?: string
      visitorType?: 'human' | 'agent'
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
      if (message && !feedback?.pageFeedback) {
        return NextResponse.json({ error: 'Written feedback is disabled.' }, { status: 403 })
      }
    }

    if (!page || !vote) {
      return NextResponse.json({ error: 'Missing page or vote' }, { status: 400 })
    }

    if (vote === 'yes' || vote === 'no') {
      try {
        await recordAnalyticsEvent({
          type: 'feedback',
          path: url ?? page,
          page,
          vote,
          message: typeof message === 'string' ? message.trim().slice(0, 500) : undefined,
          visitorType: visitorType ?? 'human',
        })
      } catch (error) {
        // Never let an analytics write failure break the user's request.
        console.error('feedback: failed to record analytics event', error)
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
