/**
 * POST /api/chat — streaming docs-QA answers (Thally AI). Feature logic for
 * the thin route shell at src/app/api/chat/route.ts; lives behind the cloud
 * bridge so OSS builds without src/cloud simply have no visitor chat.
 */

import Anthropic from '@anthropic-ai/sdk'
import { type NextRequest } from 'next/server'
import { getAiConfig } from '@/data/docs'
import { siteConfig } from '@/data/site'
import { getRelevantChunks } from '@/lib/embeddings'
import { getSiteUrl } from '@/lib/site-url'
import type { RetrievalResult } from '@/lib/embeddings'
import { getContentDocument } from '@/lib/content'
import { getDocEntries } from '@/data/docs'
import { trackAnalyticsEvent } from '@/cloud/analytics/store'
import { recordChatInsight, WEAK_SCORE } from '@/cloud/ai/chat-insights'
import { resolveChatKey, resolveAnthropicKey, checkChatRateLimit } from '@/cloud/ai/chat-access'

// ---------------------------------------------------------------------------
// Retrieval-augmented context
// ---------------------------------------------------------------------------

const baseUrl = getSiteUrl()
// Retrieval fallback budget — only used when the full corpus is too large to
// fit the model's context window (see FULL_CONTEXT_MAX_TOKENS below).
const CONTEXT_TOKEN_BUDGET = 2200
const MAX_CHUNKS = 8

// Full-context mode: the assistant is given the ENTIRE documentation (every
// page, in full — including pages added in the future) rather than a handful
// of retrieved chunks, so it can answer any question with complete coverage.
// The stable corpus is cached on the request (prompt caching) so repeat
// questions read it at ~0.1x instead of re-paying for it every turn.
// Above this token estimate we fall back to retrieval so the corpus + the
// conversation + the response can never overflow the context window (Haiku 4.5
// is 200K; this leaves generous room for multi-turn history and output).
const FULL_CONTEXT_MAX_TOKENS = 120_000

interface CorpusPage {
  title: string
  href: string
}

let cachedCorpus: { text: string; pages: Array<CorpusPage>; approxTokens: number } | null = null

/**
 * Build the full-documentation corpus from every doc page's raw MDX body — the
 * same source the machine-readable `.md` mirror serves, so nothing (Cards,
 * Hero, Tiles, future components) is dropped. Memoized so the system prefix is
 * byte-identical across requests, which is what makes prompt caching hit.
 */
function buildFullDocsCorpus(): { text: string; pages: Array<CorpusPage>; approxTokens: number } {
  const pages: Array<CorpusPage> = []
  const blocks: Array<string> = []
  for (const entry of getDocEntries()) {
    const document = getContentDocument(entry.id)
    const body = document?.rawBody?.trim()
    if (!body) continue
    pages.push({ title: entry.title, href: entry.href })
    // Each page is headed by its title + URL so the model can link to it inline
    // as a natural Markdown link (no bracketed reference numbers).
    blocks.push(`## ${entry.title}\nURL: ${baseUrl}${entry.href}\n\n${body}`)
  }
  const text = blocks.join('\n\n---\n\n')
  return { text, pages, approxTokens: Math.ceil(text.length / 4) }
}

function getFullDocsCorpus() {
  if (!cachedCorpus) cachedCorpus = buildFullDocsCorpus()
  return cachedCorpus
}

interface Citation {
  index: number
  title: string
  heading: string
  url: string
}

function sourceUrl(result: RetrievalResult): string {
  const { href, anchor } = result.chunk
  return anchor ? `${baseUrl}${href}#${anchor}` : `${baseUrl}${href}`
}

function buildRetrievedContext(results: Array<RetrievalResult>): { context: string; citations: Array<Citation> } {
  const citations: Array<Citation> = []
  const blocks: Array<string> = []

  results.forEach((result, i) => {
    const index = i + 1
    const heading = result.chunk.headingPath.join(' > ') || result.chunk.title
    citations.push({ index, title: result.chunk.title, heading, url: sourceUrl(result) })
    blocks.push(`[${index}] ${heading}\n${result.chunk.text}`)
  })

  return { context: blocks.join('\n\n---\n\n'), citations }
}

function latestUserQuery(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user' && messages[i].content.trim()) return messages[i].content.trim()
  }
  return ''
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Whether a chat key is configured — gates rendering the visitor chat widget. */
export function isChatConfigured(): boolean {
  return Boolean(resolveAnthropicKey())
}

export async function handleChat(request: NextRequest): Promise<Response> {
  const aiConfig = getAiConfig()
  if (!aiConfig.chat) {
    return new Response('AI chat is not enabled for this project.', { status: 403 })
  }

  // Resolve the active key tier: the owner's own key (generous limits) or the
  // shared trial key that powers the out-of-the-box "aha" experience.
  const resolved = await resolveChatKey()
  if (!resolved) {
    return new Response(
      'AI chat needs an Anthropic key. Set ANTHROPIC_API_KEY (your own key) to enable it.',
      { status: 503 },
    )
  }
  const { apiKey, tier } = resolved

  // Tier-aware rate limiting (trial keys are tightly capped).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const decision = checkChatRateLimit(ip, tier)
  if (decision.limited) {
    const message =
      decision.reason === 'global_daily'
        ? 'The shared trial key has reached its daily limit. Add your own ANTHROPIC_API_KEY for unlimited use.'
        : tier === 'trial'
          ? 'Trial rate limit reached. Add your own ANTHROPIC_API_KEY to lift these limits.'
          : 'Rate limit exceeded. Please wait a moment before asking again.'
    return new Response(message, {
      status: 429,
      headers: {
        'x-thally-ai-tier': tier,
        ...(decision.retryAfter ? { 'Retry-After': String(decision.retryAfter) } : {}),
      },
    })
  }

  let messages: Array<{ role: 'user' | 'assistant'; content: string }>
  try {
    const body = await request.json() as { messages?: unknown }
    if (!Array.isArray(body.messages)) throw new Error('invalid')
    messages = body.messages as Array<{ role: 'user' | 'assistant'; content: string }>
  } catch {
    return new Response('Invalid request body. Expected { messages: [...] }', { status: 400 })
  }

  if (messages.length === 0) {
    return new Response('No messages provided.', { status: 400 })
  }

  try {
    await trackAnalyticsEvent({
      type: 'chat_message',
      path: '/api/chat',
      visitorType: 'human',
    })
  } catch (error) {
    // Analytics is best-effort — never block a chat response on a write.
    console.error('chat: failed to record analytics event', error)
  }

  const query = latestUserQuery(messages)
  const persona = aiConfig.systemPrompt?.trim()

  // Full-context mode (primary): give the model the ENTIRE documentation so any
  // question — including about pages added later — has complete coverage.
  // Falls back to retrieval only if the corpus is too large for the window.
  const corpus = getFullDocsCorpus()
  const useFullContext = corpus.approxTokens <= FULL_CONTEXT_MAX_TOKENS

  // system is an array so the (stable) docs prefix carries a cache breakpoint;
  // the volatile question stays in `messages`, after the breakpoint.
  let system: Array<Anthropic.TextBlockParam>
  let footerFor: (answer: string) => string

  if (useFullContext) {
    const systemText = `You are a helpful documentation assistant for ${siteConfig.name}.
The COMPLETE ${siteConfig.name} documentation is included below — every page, in full. Answer using it.
Only say something isn't documented if it is genuinely absent from the pages below.
The source below is MDX and contains JSX components (e.g. <Steps>, <Step>, <Card>, <Tabs>, <CodeGroup>, frontmatter). ALWAYS reply in plain GitHub-flavored Markdown only — never output JSX/MDX component tags or frontmatter. Convert component content to equivalent Markdown (a <Steps> block becomes a numbered list, a <CodeGroup> becomes a fenced code block, a <Card> becomes a link, etc.).
When you reference a documentation page, link to it inline as a Markdown link using the page's URL, e.g. [Quickstart](/quickstart). Do NOT use bracketed reference numbers like [1] or [2].
Keep answers concise and use markdown where helpful.${persona ? `\n\nAdditional instructions:\n${persona}` : ''}

Documentation — each page below is given with its title and URL:
${corpus.text}`
    system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }]
    footerFor = () => ''
    recordChatInsight({
      question: query.slice(0, 500),
      chunkCount: corpus.pages.length,
      topScore: 1,
      slugs: [],
      tier,
      weak: false,
    })
  } else {
    // Fallback: documentation is too large to send in full — retrieve the most
    // relevant chunks within a token budget.
    const results = await getRelevantChunks(query, { k: MAX_CHUNKS, tokenBudget: CONTEXT_TOKEN_BUDGET })
    const { context, citations } = buildRetrievedContext(results)
    const topScore = results[0]?.score ?? 0
    recordChatInsight({
      question: query.slice(0, 500),
      chunkCount: results.length,
      topScore,
      slugs: citations.map((c) => c.url).slice(0, 5),
      tier,
      weak: results.length === 0 || topScore < WEAK_SCORE,
    })
    const sourceList = citations
      .map((citation) => `- ${citation.heading} — ${citation.url}`)
      .join('\n')
    const systemText = `You are a helpful documentation assistant for ${siteConfig.name}.
Answer questions based ONLY on the documentation excerpts provided below.
If the answer isn't in the excerpts, say so clearly — don't guess.
When you reference a page, link to it inline as a Markdown link using its URL from the Sources list. Do NOT use bracketed reference numbers like [1] or [2].
Keep answers concise. Use markdown formatting where helpful.${persona ? `\n\nAdditional instructions:\n${persona}` : ''}

${context ? `Documentation excerpts:\n${context}\n\nSources:\n${sourceList}` : 'No relevant documentation excerpts were found for this question.'}`
    system = [{ type: 'text', text: systemText }]
    footerFor = () => ''
  }

  const client = new Anthropic({ apiKey })

  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system,
    messages,
  })

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let answer = ''
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            answer += event.delta.text
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        // Append a Sources footer so every answer is traceable to pages.
        const footer = footerFor(answer)
        if (footer) controller.enqueue(encoder.encode(footer))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-store',
      'x-thally-ai-tier': tier,
    },
  })
}
