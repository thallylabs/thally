/**
 * Server-only adapters for Thally Cloud's site-scoped paid data plane.
 *
 * Managed sites authenticate with a revocable release grant; externally hosted
 * sites use the same short-lived grant they already exchange for settings.
 * Browser code never receives either credential. Failures degrade to the free
 * runtime instead of breaking documentation delivery.
 */

import 'server-only'

import '@/lib/search/register-doc-source'
import { getRelevantChunks } from '@thallylabs/core'
import { siteConfig } from '@/data/site'
import {
  MAX_AI_CHAT_REQUEST_BYTES,
  parseAiChatMessages,
  type AiChatMessage,
} from '@/lib/ai-chat-messages'
import {
  AI_ANSWER_SOURCES_HEADER,
  serializeAiAnswerSources,
} from '@/lib/ai-answer-sources'
import type { AnalyticsEvent } from '@/lib/analytics/types'
import { getCloudServiceGrant, getCloudSiteConfig } from './client'

const DEFAULT_CLOUD_URL = 'https://app.thally.io'
const REQUEST_TIMEOUT_MS = 30_000
function cloudUrl(pathname: string): URL {
  const configured =
    process.env.THALLY_CLOUD_URL?.trim() ||
    process.env.DOX_CLOUD_URL?.trim() ||
    DEFAULT_CLOUD_URL
  return new URL(pathname, configured.endsWith('/') ? configured : `${configured}/`)
}

function latestQuestion(messages: ReadonlyArray<AiChatMessage>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages[index].content
  }
  return ''
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_AI_CHAT_REQUEST_BYTES) {
    throw new Error('body_too_large')
  }
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Array<Uint8Array> = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_AI_CHAT_REQUEST_BYTES) {
      await reader.cancel()
      throw new Error('body_too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
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

  const body = await readBoundedJson(request).catch(() => null)
  const messages = parseAiChatMessages(
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { messages?: unknown }).messages
      : null,
  )
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
      body: JSON.stringify({
        siteName: cloud.siteConfig.portable.details?.name ?? siteConfig.name,
        messages,
        context,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return new Response('Thally AI is temporarily unavailable.', { status: 503 })
  }

  // The retrieval happened in this trusted runtime, so expose that bounded
  // local evidence rather than accepting link metadata from the remote model.
  const sourcesHeader = serializeAiAnswerSources(context)

  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('retry-after')
        ? { 'retry-after': response.headers.get('retry-after')! }
        : {}),
      ...(response.ok && sourcesHeader
        ? { [AI_ANSWER_SOURCES_HEADER]: sourcesHeader }
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
