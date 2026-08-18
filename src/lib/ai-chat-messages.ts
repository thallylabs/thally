/**
 * Public request contract for ephemeral Ask AI screenshot context.
 *
 * Images are base64 payloads carried only with chat requests. Keeping the
 * contract bounded prevents the browser and linked Cloud proxy from becoming
 * an accidental general-purpose upload path.
 */

export const AI_CHAT_IMAGE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const

export type AiChatImageMediaType = (typeof AI_CHAT_IMAGE_MEDIA_TYPES)[number]

export const MAX_AI_CHAT_IMAGES = 2
export const MAX_AI_CHAT_IMAGE_BYTES = 3 * 1024 * 1024
export const MAX_AI_CHAT_REQUEST_BYTES = 10 * 1024 * 1024
export const MAX_AI_CHAT_MESSAGES = 24
export const MAX_AI_CHAT_MESSAGE_CHARS = 8_000

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export interface AiChatImage {
  mediaType: AiChatImageMediaType
  data: string
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  images?: Array<AiChatImage>
}

/**
 * Keep only the most recent screenshot group in a stateless chat request.
 * This preserves follow-up context without making request size grow on every
 * turn; earlier screenshots remain visible in browser memory only.
 */
export function createAiChatRequestMessages(
  messages: ReadonlyArray<AiChatMessage>,
): Array<AiChatMessage> {
  let latestImageIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && messages[index]?.images?.length) {
      latestImageIndex = index
      break
    }
  }
  return messages.map((message, index) => ({
    role: message.role,
    content: message.content,
    ...(index === latestImageIndex && message.images?.length
      ? {
          images: message.images.map(({ mediaType, data }) => ({ mediaType, data })),
        }
      : {}),
  }))
}

export function isAiChatImageMediaType(
  value: unknown,
): value is AiChatImageMediaType {
  return AI_CHAT_IMAGE_MEDIA_TYPES.includes(value as AiChatImageMediaType)
}

function decodedBase64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor((value.length * 3) / 4) - padding
}

/** Validate image metadata and encoded size without decoding untrusted bytes. */
export function parseAiChatImages(value: unknown): Array<AiChatImage> | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_AI_CHAT_IMAGES) return null

  const images: Array<AiChatImage> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const { mediaType, data } = item as Record<string, unknown>
    if (
      !isAiChatImageMediaType(mediaType) ||
      typeof data !== 'string' ||
      !data ||
      data.length % 4 !== 0 ||
      !BASE64_PATTERN.test(data) ||
      decodedBase64Bytes(data) > MAX_AI_CHAT_IMAGE_BYTES
    ) {
      return null
    }
    images.push({ mediaType, data })
  }
  return images
}

/** Validate the browser-to-runtime message envelope before Cloud forwarding. */
export function parseAiChatMessages(value: unknown): Array<AiChatMessage> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AI_CHAT_MESSAGES) {
    return null
  }

  const messages: Array<AiChatMessage> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (
      (record.role !== 'user' && record.role !== 'assistant') ||
      typeof record.content !== 'string'
    ) {
      return null
    }
    const content = record.content.trim()
    const images = parseAiChatImages(record.images)
    if (!content || content.length > MAX_AI_CHAT_MESSAGE_CHARS || images === null) {
      return null
    }
    if (record.role === 'assistant' && images.length > 0) return null
    messages.push({
      role: record.role,
      content,
      ...(images.length > 0 ? { images } : {}),
    })
  }
  return messages
}
