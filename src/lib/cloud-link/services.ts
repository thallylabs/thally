/**
 * Server-only adapters for Thally Cloud's site-scoped paid data plane.
 *
 * Managed sites authenticate with a revocable release grant; externally hosted
 * sites use the same short-lived grant they already exchange for settings.
 * Browser code never receives either credential. Failures degrade to the free
 * runtime instead of breaking documentation delivery.
 */

import 'server-only'

import { getRelevantChunks } from '@thallylabs/core'
import { siteConfig } from '@/data/site'
import type { AnalyticsEvent } from '@/lib/analytics/types'
import { getCloudServiceGrant, getCloudSiteConfig } from './client'

const DEFAULT_CLOUD_URL = 'https://app.thally.io'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_CHAT_MESSAGES = 24
const MAX_MESSAGE_CHARS = 8_000

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function cloudUrl(pathname: string): URL {
  const configured =
    process.env.THALLY_CLOUD_URL?.trim() ||
    process.env.DOX_CLOUD_URL?.trim() ||
    DEFAULT_CLOUD_URL
  return new URL(pathname, configured.endsWith('/') ? configured : `${configured}/`)
}

function parseChatMessages(value: unknown): Array<ChatMessage> | null {
  if (!value || typeof value !== 'object') return null
  const messages = (value as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_CHAT_MESSAGES) {
    return null
  }
  const parsed: Array<ChatMessage> = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') return null
    const { role, content } = message as { role?: unknown; content?: unknown }
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      !content.trim() ||
      content.length > MAX_MESSAGE_CHARS
    ) {
      return null
    }
    parsed.push({ role, content: content.trim() })
  }
  return parsed
}

function latestQuestion(messages: ReadonlyArray<ChatMessage>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index].content
  }
  return ''
}

/** Whether the linked site is entitled, enabled, and credentialed for AI chat. */
export async function isCloudAiAvailable(siteUrl: string): Promise<boolean> {
  const cloud = await getCloudSiteConfig(siteUrl)
  if (!cloud?.entitlements.features?.aiAnswers || !cloud.siteConfig.portable.ai?.enabled) {
    return false
  }
  return Boolean(await getCloudServiceGrant(siteUrl))
}

/** Build bounded retrieval context locally and stream a metered Cloud answer. */
export async function handleCloudAiChat(request: Request): Promise<Response> {
  const siteUrl = new URL(request.url).origin
  const cloud = await getCloudSiteConfig(siteUrl)
  if (!cloud?.entitlements.features?.aiAnswers || !cloud.siteConfig.portable.ai?.enabled) {
    return new Response('AI chat is not enabled for this site.', { status: 403 })
  }
  const grant = await getCloudServiceGrant(siteUrl)
  if (!grant) return new Response('AI chat is not enabled for this site.', { status: 403 })

  const body = await request.json().catch(() => null)
  const messages = parseChatMessages(body)
  if (!messages) {
    return new Response('Invalid request body. Expected a bounded messages array.', {
      status: 400,
    })
  }
  const question = latestQuestion(messages)
  if (!question) return new Response('No user question was provided.', { status: 400 })

  const results = await getRelevantChunks(question, { k: 8, tokenBudget: 4_000 })
  const context = results.map(({ chunk }) => ({
    title: chunk.title,
    heading: chunk.headingPath.join(' > ') || chunk.title,
    url: `${chunk.href}${chunk.anchor ? `#${chunk.anchor}` : ''}`,
    text: chunk.text,
  }))

  let response: Response
  try {
    response = await fetch(cloudUrl('api/runtime/chat'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${grant}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ siteName: siteConfig.name, messages, context }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return new Response('Thally AI is temporarily unavailable.', { status: 503 })
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('retry-after')
        ? { 'retry-after': response.headers.get('retry-after')! }
        : {}),
    },
  })
}

/** Send one bounded analytics event to the linked site's durable Cloud store. */
export async function recordCloudAnalyticsEvent(
  siteUrl: string,
  event: Omit<AnalyticsEvent, 'id' | 'ts'> & { ts?: number },
): Promise<void> {
  const cloud = await getCloudSiteConfig(siteUrl)
  if (
    !cloud?.entitlements.features?.analytics ||
    !cloud.siteConfig.portable.analytics?.enabled ||
    (event.visitorType === 'agent' &&
      cloud.siteConfig.portable.analytics.collectAgentTraffic === false)
  ) {
    return
  }
  const grant = await getCloudServiceGrant(siteUrl)
  if (!grant) return

  const response = await fetch(cloudUrl('api/runtime/analytics'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(event),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null)
  if (response?.body) await response.body.cancel().catch(() => undefined)
}
