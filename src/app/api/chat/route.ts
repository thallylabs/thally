import { type NextRequest } from 'next/server'
import { handleAiChat } from '@/lib/cloud-bridge'

/**
 * Thally AI answers — thin shell; the streaming RAG pipeline lives in the
 * cloud tier (src/cloud/ai). 404s on deployments without it; the chat widget
 * also hides itself via /api/chat-status.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handleAiChat(request)
}
