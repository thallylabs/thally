/** Ephemeral screenshot request-contract coverage. */

import { describe, expect, it } from 'vitest'

import {
  MAX_AI_CHAT_IMAGE_BYTES,
  createAiChatRequestMessages,
  parseAiChatImages,
  parseAiChatMessages,
  type AiChatImage,
} from '@/lib/ai-chat-messages'

const png = {
  mediaType: 'image/png',
  data: 'iVBORw0KGgo=',
} satisfies AiChatImage

describe('Ask AI screenshot messages', () => {
  it('accepts bounded user screenshots without allowing assistant images', () => {
    expect(
      parseAiChatMessages([
        { role: 'user', content: 'What is wrong here?', images: [png] },
      ]),
    ).toEqual([
      { role: 'user', content: 'What is wrong here?', images: [png] },
    ])
    expect(
      parseAiChatMessages([
        { role: 'assistant', content: 'Answer', images: [png] },
      ]),
    ).toBeNull()
  })

  it('rejects unsupported, malformed, and oversized image payloads', () => {
    expect(parseAiChatImages([{ mediaType: 'image/svg+xml', data: 'PHN2Zz4=' }])).toBeNull()
    expect(parseAiChatImages([{ mediaType: 'image/png', data: 'not base64' }])).toBeNull()
    expect(
      parseAiChatImages([
        {
          mediaType: 'image/png',
          data: 'A'.repeat(Math.ceil((MAX_AI_CHAT_IMAGE_BYTES + 1) / 3) * 4),
        },
      ]),
    ).toBeNull()
  })

  it('keeps only the latest screenshot group for stateless follow-ups', () => {
    expect(
      createAiChatRequestMessages([
        { role: 'user', content: 'First', images: [png] },
        { role: 'assistant', content: 'Answer' },
        { role: 'user', content: 'Follow-up' },
      ]),
    ).toEqual([
      { role: 'user', content: 'First', images: [png] },
      { role: 'assistant', content: 'Answer' },
      { role: 'user', content: 'Follow-up' },
    ])

    expect(
      createAiChatRequestMessages([
        { role: 'user', content: 'First', images: [png] },
        { role: 'user', content: 'Second', images: [png] },
      ]),
    ).toEqual([
      { role: 'user', content: 'First' },
      { role: 'user', content: 'Second', images: [png] },
    ])
  })
})
