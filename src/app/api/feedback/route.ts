import { NextResponse } from 'next/server'
import { recordAnalyticsEvent } from '@/lib/cloud-bridge'

/**
 * POST /api/feedback
 *
 * Receives page feedback votes from the Feedback component.
 * Body: { page: string, vote: "yes" | "no", url: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { page, vote, url } = body as { page?: string; vote?: string; url?: string }

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
          visitorType: 'human',
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
