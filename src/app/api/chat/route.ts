import { type NextRequest } from 'next/server'
import { getCloud } from '@/lib/cloud-bridge'

/**
 * Thally AI answers — thin shell; the streaming RAG pipeline lives in the
 * cloud tier (src/cloud/ai). 404s on deployments without it; the chat widget
 * also hides itself via /api/chat-status.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const ai = getCloud()?.ai
  if (!ai) return new Response('AI chat is not available on this deployment.', { status: 404 })
  return ai.handleChat(request)
}
