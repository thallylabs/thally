/** RFC 9457 and backwards-compatibility coverage for public API errors. */

import { describe, expect, it } from 'vitest'
import { problemResponse } from '@/lib/http/problem'

describe('problemResponse', () => {
  it('returns RFC 9457 fields plus stable compatibility aliases', async () => {
    const response = problemResponse({
      status: 404,
      code: 'missing_resource',
      title: 'Resource missing',
      detail: 'The requested resource does not exist.',
      resolution: 'Read the index and retry with a published identifier.',
      instance: '/api/example',
      extensions: { suggestions: ['/api/docs-index'] },
    })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json; charset=utf-8',
    )
    await expect(response.json()).resolves.toEqual({
      type: 'https://thally.io/problems/missing_resource',
      title: 'Resource missing',
      status: 404,
      code: 'missing_resource',
      detail: 'The requested resource does not exist.',
      resolution: 'Read the index and retry with a published identifier.',
      instance: '/api/example',
      error: 'missing_resource',
      message: 'The requested resource does not exist.',
      suggestions: ['/api/docs-index'],
    })
  })
})
