import { NextResponse } from 'next/server'
import { getCloud } from '@/lib/cloud-bridge'

export const runtime = 'nodejs'

/**
 * Thally Track webhook — thin shell; the pipeline lives in the cloud tier
 * (src/cloud/track). 404s on deployments without it (OSS free tier).
 */
export async function POST(request: Request) {
  const track = getCloud()?.track
  if (!track) return NextResponse.json({ error: 'track_unavailable' }, { status: 404 })
  return track.handleWebhook(request)
}
