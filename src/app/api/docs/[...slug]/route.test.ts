/** Problem Details coverage for missing structured documentation pages. */

import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/docs/[...slug]', () => {
  it('returns a repairable JSON problem for an unknown page', async () => {
    const response = await GET(
      new NextRequest('https://docs.example.com/api/docs/not-a-real-page', {
        headers: { accept: 'application/json' },
      }),
      { params: Promise.resolve({ slug: ['not-a-real-page'] }) },
    )
    const problem = await response.json()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain(
      'application/problem+json',
    )
    expect(problem).toMatchObject({
      code: 'not_found',
      status: 404,
      instance: '/api/docs/not-a-real-page',
      docs_index: 'https://docs.example.com/llms.txt',
      did_you_mean: [],
    })
    expect(problem.resolution).toContain('/api/docs-index')
  })

  it('returns the documented Markdown problem when no JSON format is requested', async () => {
    const response = await GET(
      new NextRequest('https://docs.example.com/api/docs/not-a-real-page'),
      { params: Promise.resolve({ slug: ['not-a-real-page'] }) },
    )
    const body = await response.text()

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(body).toContain('# 404 — Page not found')
    expect(body).toContain('https://docs.example.com/llms.txt')
  })
})
