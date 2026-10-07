/**
 * Agent-facing projection of a normalized OpenAPI operation.
 *
 * One projection backs every machine surface that describes an API operation
 * to an agent: MCP `list_api_operations` / `get_api_operation`, the compact
 * operation blocks in `llms-full.txt`, and the API-operation records in search.
 * It reads the same `NormalizedOperation` the human API reference renders, so
 * the surfaces cannot disagree about methods, paths, parameters or schemas.
 *
 * Invariants:
 * - **No credentials.** `authSchemes[].prefill` and the operation `prefill`
 *   maps can carry real tokens from `docs.json` `apiPlayground.credentials`
 *   (they power the Try It console). Nothing here reads them; examples use
 *   `<token>`-style placeholders. Request-body samples are generated from the
 *   schema, not from configuration.
 * - **Bounded output.** Resolved schemas are acyclic but may share large
 *   subtrees (a DAG), so naive serialization can explode. `compactSchema`
 *   caps depth, node count, enum length and description length.
 * - **Published operations only.** Callers pass nodes from
 *   `getAllApiOperationNodes()`, which already drops hidden/excluded
 *   operations and page-only specs.
 */

import type { ApiOperationNode } from '@/data/api-reference'
import { buildCurlCommand } from '@/lib/openapi/code-samples'
import { formatExample, responseExamples } from '@/lib/openapi/response-examples'
import type { NormalizedAuthScheme, NormalizedMediaType, NormalizedOperation } from '@/lib/openapi/types'

/** Stable, URL-shaped operation id shared by docs-index, search and MCP (`<spec>/<slug...>`). */
export function apiOperationId(node: Pick<ApiOperationNode, 'slug'>): string {
  return node.slug.join('/')
}

export interface ApiOperationSummary {
  id: string
  title: string
  method: string
  path: string
  description: string
  group: string
  tags: Array<string>
  /** Absolute URL of the human reference page. */
  url: string
  is_webhook: boolean
}

export interface ApiOperationParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  description?: string
  schema?: Record<string, unknown>
}

export interface ApiOperationBody {
  required: boolean
  description?: string
  content_type: string
  schema?: Record<string, unknown>
}

export interface ApiOperationResponse {
  status: string
  description?: string
  content_type?: string
  schema?: Record<string, unknown>
}

export interface ApiOperationAuthScheme {
  name: string
  kind: NormalizedAuthScheme['kind']
  in: NormalizedAuthScheme['in']
  param_name: string
  description?: string
}

export interface ApiOperationDetail extends ApiOperationSummary {
  servers: Array<string>
  parameters: Array<ApiOperationParameter>
  request_body?: ApiOperationBody
  responses: Array<ApiOperationResponse>
  auth: {
    /** True when every security alternative needs a credential. */
    required: boolean
    schemes: Array<ApiOperationAuthScheme>
  }
  example: {
    /** cURL request with placeholder credentials. Empty when the spec declares no server URL. */
    curl: string
    response?: { status: string; body: string }
  }
}

const SCHEMA_MAX_DEPTH = 6
const SCHEMA_MAX_NODES = 300
const SCHEMA_MAX_ENUM = 25
const TEXT_MAX = 400
const EXAMPLE_MAX = 4000

/** Schema keywords worth an agent's tokens; vendor extensions and UI hints are dropped. */
const SCHEMA_SCALAR_KEYS = [
  'type', 'format', 'title', 'nullable', 'default', 'const', 'pattern', 'deprecated', 'readOnly', 'writeOnly',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
] as const

function truncate(value: string, max = TEXT_MAX): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Copy a resolved JSON Schema with hard caps on depth and total nodes. Past a
 * cap the subtree becomes `{ description: '[truncated]' }`, which an agent can
 * follow up on by reading the human page or the published spec.
 */
export function compactSchema(schema: unknown, budget = { nodes: SCHEMA_MAX_NODES }, depth = 0): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined
  if (depth >= SCHEMA_MAX_DEPTH || budget.nodes <= 0) return { description: '[truncated]' }
  budget.nodes -= 1
  const out: Record<string, unknown> = {}
  for (const key of SCHEMA_SCALAR_KEYS) {
    const value = schema[key]
    if (value === undefined) continue
    if (typeof value === 'string') out[key] = truncate(value)
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value
    else if (key === 'type' && Array.isArray(value)) out[key] = value.filter((item) => typeof item === 'string')
  }
  if (typeof schema.description === 'string' && schema.description.trim()) out.description = truncate(schema.description.trim())
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, SCHEMA_MAX_ENUM).filter((item) => item === null || typeof item !== 'object')
  if (Array.isArray(schema.required)) out.required = schema.required.filter((item) => typeof item === 'string')
  if (isRecord(schema.properties)) {
    const properties: Record<string, unknown> = {}
    for (const [name, child] of Object.entries(schema.properties)) {
      if (budget.nodes <= 0) {
        properties['…'] = { description: '[more properties truncated]' }
        break
      }
      const compact = compactSchema(child, budget, depth + 1)
      if (compact) properties[name] = compact
    }
    out.properties = properties
  }
  if (schema.items !== undefined) {
    const items = compactSchema(schema.items, budget, depth + 1)
    if (items) out.items = items
  }
  if (typeof schema.additionalProperties === 'boolean') out.additionalProperties = schema.additionalProperties
  else if (isRecord(schema.additionalProperties)) out.additionalProperties = compactSchema(schema.additionalProperties, budget, depth + 1)
  for (const combinator of ['allOf', 'anyOf', 'oneOf'] as const) {
    const members = schema[combinator]
    if (!Array.isArray(members)) continue
    out[combinator] = members
      .map((member) => compactSchema(member, budget, depth + 1))
      .filter((member): member is Record<string, unknown> => member !== undefined)
  }
  return out
}

function primaryContent(contents: Array<NormalizedMediaType>): NormalizedMediaType | undefined {
  return contents.find((content) => content.mediaType.includes('json')) ?? contents[0]
}

function operationDescription(operation: NormalizedOperation): string {
  return operation.description?.trim() || `${operation.method} ${operation.path}`
}

/** The listing shape: enough to choose an operation without its schemas. */
export function summarizeApiOperation(node: ApiOperationNode, origin: string): ApiOperationSummary {
  const { operation } = node
  return {
    id: apiOperationId(node),
    title: operation.title,
    method: operation.method,
    path: operation.path,
    description: truncate(operationDescription(operation)),
    group: operation.group,
    tags: operation.tags,
    url: `${origin}${node.href}`,
    is_webhook: operation.isWebhook,
  }
}

/** Header a scheme's credential travels in, with a placeholder value (never a configured token). */
function placeholderHeader(scheme: NormalizedAuthScheme): [string, string] | null {
  if (scheme.in !== 'header') return null
  if (scheme.kind === 'bearer') return ['Authorization', 'Bearer <token>']
  if (scheme.kind === 'basic') return ['Authorization', 'Basic <credentials>']
  return [scheme.paramName, '<api-key>']
}

function curlExample(operation: NormalizedOperation, body: ApiOperationBody | undefined): string {
  const server = operation.servers[0]?.url?.replace(/\/$/, '')
  if (!server || operation.isWebhook) return ''
  const headers: Record<string, string> = {}
  const firstScheme = operation.authSchemes[0]
  const auth = firstScheme ? placeholderHeader(firstScheme) : null
  if (auth) headers[auth[0]] = auth[1]
  const requestBody = operation.prefill.body
  if (requestBody && body) headers['Content-Type'] = body.content_type
  const query = operation.parameters.query.filter((param) => param.required).map((param) => `${encodeURIComponent(param.name)}={${param.name}}`)
  const url = `${server}${operation.path}${query.length ? `?${query.join('&')}` : ''}`
  return buildCurlCommand(operation.method, url, headers, requestBody ? truncate(requestBody, EXAMPLE_MAX) : undefined).join('\n')
}

function responseExample(operation: NormalizedOperation): ApiOperationDetail['example']['response'] {
  const success = operation.responses.find((response) => /^2/.test(response.code)) ?? operation.responses[0]
  if (!success) return undefined
  const [example] = responseExamples(success)
  if (!example) return undefined
  return { status: success.code, body: truncate(formatExample(example.value), EXAMPLE_MAX) }
}

/** The full agent-facing description of one operation. */
export function describeApiOperation(node: ApiOperationNode, origin: string): ApiOperationDetail {
  const { operation } = node
  const parameters: Array<ApiOperationParameter> = (['path', 'query', 'header', 'cookie'] as const).flatMap((location) =>
    operation.parameters[location].map((param) => ({
      name: param.name,
      in: location,
      required: param.required,
      ...(param.description ? { description: truncate(param.description) } : {}),
      ...(param.schema ? { schema: compactSchema(param.schema) } : {}),
    })))
  const bodyContent = operation.requestBody ? primaryContent(operation.requestBody.contents) : undefined
  const requestBody: ApiOperationBody | undefined = operation.requestBody && bodyContent
    ? {
        required: operation.requestBody.required,
        ...(operation.requestBody.description ? { description: truncate(operation.requestBody.description) } : {}),
        content_type: bodyContent.mediaType,
        ...(bodyContent.schema ? { schema: compactSchema(bodyContent.schema) } : {}),
      }
    : undefined
  const responses = operation.responses.map((response) => {
    const content = primaryContent(response.contents)
    return {
      status: response.code,
      ...(response.description ? { description: truncate(response.description) } : {}),
      ...(content ? { content_type: content.mediaType } : {}),
      ...(content?.schema ? { schema: compactSchema(content.schema) } : {}),
    }
  })
  const response = responseExample(operation)
  return {
    ...summarizeApiOperation(node, origin),
    description: truncate(operationDescription(operation), 2000),
    servers: operation.servers.map((server) => server.url),
    parameters,
    ...(requestBody ? { request_body: requestBody } : {}),
    responses,
    auth: {
      // An empty requirement object (`{}`) in `security` means anonymous access is allowed.
      required: operation.security.length > 0 && operation.security.every((requirement) => requirement.length > 0),
      schemes: operation.authSchemes.map((scheme) => ({
        name: scheme.name,
        kind: scheme.kind,
        in: scheme.in,
        param_name: scheme.paramName,
        ...(scheme.description ? { description: truncate(scheme.description) } : {}),
      })),
    },
    example: { curl: curlExample(operation, requestBody), ...(response ? { response } : {}) },
  }
}

function schemaTypeLabel(schema: Record<string, unknown> | undefined): string {
  if (!schema) return ''
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : typeof schema.type === 'string' ? schema.type : ''
  if (type === 'array' && isRecord(schema.items)) return `array of ${schemaTypeLabel(schema.items) || 'items'}`
  return type
}

/** Top-level fields of an object schema as `name (type, required)` fragments. */
function topLevelFields(schema: Record<string, unknown> | undefined): Array<string> {
  if (!schema || !isRecord(schema.properties)) return []
  const required = new Set(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries(schema.properties).map(([name, child]) => {
    const attributes = [schemaTypeLabel(isRecord(child) ? child : undefined), required.has(name) ? 'required' : ''].filter(Boolean)
    return `\`${name}\`${attributes.length ? ` (${attributes.join(', ')})` : ''}`
  })
}

/**
 * Compact Markdown for one operation — the form `llms-full.txt` embeds.
 * Deliberately shallow (top-level fields only); agents that need full
 * schemas call MCP `get_api_operation` or read the human page.
 */
export function apiOperationMarkdown(detail: ApiOperationDetail): string {
  const lines: Array<string> = [`## ${detail.method} ${detail.path} — ${detail.title}`, '', `URL: ${detail.url}`, '']
  if (detail.description && detail.description !== `${detail.method} ${detail.path}`) lines.push(detail.description, '')
  if (detail.auth.schemes.length) {
    const schemes = detail.auth.schemes.map((scheme) => `${scheme.kind} (${scheme.in} \`${scheme.param_name}\`)`).join(' or ')
    lines.push(`Auth: ${schemes}${detail.auth.required ? '' : ' (optional)'}`, '')
  }
  if (detail.parameters.length) {
    lines.push('Parameters:')
    for (const param of detail.parameters) {
      const attributes = [param.in, schemaTypeLabel(param.schema), param.required ? 'required' : ''].filter(Boolean).join(', ')
      lines.push(`- \`${param.name}\` (${attributes})${param.description ? `: ${param.description.replace(/\s+/g, ' ')}` : ''}`)
    }
    lines.push('')
  }
  if (detail.request_body) {
    const fields = topLevelFields(detail.request_body.schema)
    lines.push(`Request body (${detail.request_body.content_type}${detail.request_body.required ? ', required' : ''})${fields.length ? `: ${fields.join(', ')}` : ''}`, '')
  }
  if (detail.responses.length) {
    lines.push(`Responses: ${detail.responses.map((response) => `${response.status}${response.description ? ` ${response.description.replace(/\s+/g, ' ')}` : ''}`).join('; ')}`, '')
  }
  return lines.join('\n').trimEnd()
}
