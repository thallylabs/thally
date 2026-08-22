/** Contract coverage for the universal documentation API description. */

import { describe, expect, it } from 'vitest'
import { buildDocumentationApiOpenApi } from '@/lib/openapi/documentation-api'

describe('buildDocumentationApiOpenApi', () => {
  it('describes only real anonymous read operations', () => {
    const document = buildDocumentationApiOpenApi(
      'https://docs.example.com/a/path?ignored=true',
      'Example Docs',
    )

    expect(document.openapi).toBe('3.1.1')
    expect(document.servers).toEqual([{ url: 'https://docs.example.com' }])
    expect(document.security).toEqual([])
    expect(document.paths).toMatchObject({
      '/api/docs-index': { get: { security: [] } },
      '/api/search': { get: { security: [] } },
      '/api/docs/{page_id}': { get: { security: [] } },
      '/api/agent-readiness': { get: { security: [] } },
    })
    expect(
      (document.components as Record<string, unknown>).securitySchemes,
    ).toBeUndefined()
    expect(JSON.stringify(document)).not.toContain('oauth2')
    expect(JSON.stringify(document)).not.toContain('apiKey')
  })
})
