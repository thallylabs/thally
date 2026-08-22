/**
 * OpenAPI description for the read-only APIs built into every Thally site.
 *
 * Customer API specifications remain authoritative when configured. This
 * document is the truthful fallback for sites that only expose Thally's
 * anonymous documentation, search, and readiness endpoints.
 */

import type { OpenAPIDocument } from '@/lib/openapi/types'

const PROBLEM_RESPONSE = {
  description: 'A machine-actionable error response.',
  content: {
    'application/problem+json': {
      schema: { $ref: '#/components/schemas/Problem' },
    },
  },
}

/** Build a request-origin-bound OpenAPI 3.1 description for public site APIs. */
export function buildDocumentationApiOpenApi(
  origin: string,
  siteName = 'Thally',
): OpenAPIDocument {
  const serverOrigin = new URL(origin).origin
  const displayName = siteName.trim() || 'Thally'

  return {
    openapi: '3.1.1',
    info: {
      title: `${displayName} documentation API`,
      version: '1.0.0',
      description:
        'Read-only access to this documentation site. Every operation is public and anonymous; no OAuth server, bearer token, API key, or permission scope is required.',
    },
    externalDocs: {
      description: 'Authentication and access model',
      url: `${serverOrigin}/auth.md`,
    },
    servers: [{ url: serverOrigin }],
    // OpenAPI defines an empty security requirement array as anonymous access.
    security: [],
    tags: [
      { name: 'Discovery', description: 'Discover published pages and capabilities.' },
      { name: 'Content', description: 'Read and search the public documentation corpus.' },
      { name: 'Readiness', description: 'Inspect machine-readability health.' },
    ],
    paths: {
      '/api/docs-index': {
        get: {
          operationId: 'listDocumentationPages',
          summary: 'List published documentation pages',
          tags: ['Discovery'],
          security: [],
          responses: {
            '200': {
              description: 'The machine-readable documentation index.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DocumentIndex' },
                },
              },
            },
          },
        },
      },
      '/api/search': {
        get: {
          operationId: 'searchDocumentation',
          summary: 'Search the documentation corpus',
          tags: ['Content'],
          security: [],
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'The search query.',
              schema: { type: 'string', minLength: 1 },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum number of results.',
              schema: { type: 'integer', minimum: 1, maximum: 25, default: 8 },
            },
            {
              name: 'mode',
              in: 'query',
              required: false,
              description: 'Search ranking mode.',
              schema: { type: 'string', enum: ['hybrid', 'fulltext'], default: 'hybrid' },
            },
          ],
          responses: {
            '200': {
              description: 'Ranked documentation results.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchResults' },
                },
              },
            },
            '400': PROBLEM_RESPONSE,
          },
        },
      },
      '/api/docs/{page_id}': {
        get: {
          operationId: 'readDocumentationPage',
          summary: 'Read one published documentation page',
          description:
            'Use a page identifier returned by `/api/docs-index`. Select JSON, JSON-LD, or Markdown with the `Accept` header or `format` query parameter.',
          tags: ['Content'],
          security: [],
          parameters: [
            {
              name: 'page_id',
              in: 'path',
              required: true,
              description:
                'Stable page identifier from the documentation index. Percent-encode `/` characters in nested identifiers as `%2F`.',
              schema: { type: 'string', minLength: 1 },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['json', 'ldjson', 'md'] },
            },
          ],
          responses: {
            '200': {
              description: 'The requested page projection.',
              content: {
                'application/json': { schema: { type: 'object' } },
                'application/ld+json': { schema: { type: 'object' } },
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            '404': PROBLEM_RESPONSE,
          },
        },
      },
      '/api/agent-readiness': {
        get: {
          operationId: 'getAgentReadiness',
          summary: 'Inspect documentation readiness',
          tags: ['Readiness'],
          security: [],
          responses: {
            '200': {
              description: 'An explainable readiness report for the published corpus.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ReadinessReport' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Problem: {
          type: 'object',
          required: ['type', 'title', 'status', 'code', 'detail', 'resolution'],
          properties: {
            type: { type: 'string', format: 'uri-reference' },
            title: { type: 'string' },
            status: { type: 'integer', minimum: 400, maximum: 599 },
            code: { type: 'string' },
            detail: { type: 'string' },
            resolution: { type: 'string' },
            instance: { type: 'string', format: 'uri-reference' },
            error: { type: 'string', deprecated: true },
            message: { type: 'string', deprecated: true },
          },
        },
        DocumentIndex: {
          type: 'object',
          required: ['schema_version', 'total', 'discovery', 'pages'],
          properties: {
            schema_version: { type: 'string' },
            total: { type: 'integer', minimum: 0 },
            discovery: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
            pages: { type: 'array', items: { type: 'object' } },
          },
        },
        SearchResults: {
          type: 'object',
          required: ['schema_version', 'query', 'mode', 'total', 'results'],
          properties: {
            schema_version: { type: 'string' },
            query: { type: 'string' },
            mode: { type: 'string', enum: ['hybrid', 'fulltext'] },
            total: { type: 'integer', minimum: 0 },
            results: { type: 'array', items: { type: 'object' } },
          },
        },
        ReadinessReport: {
          type: 'object',
          required: ['schema_version', 'score', 'grade', 'subscores'],
          properties: {
            schema_version: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            grade: { type: 'string', enum: ['A', 'B', 'C', 'D', 'F'] },
            subscores: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  }
}
