export type OpenAPIDocument = Record<string, unknown>

export interface FileSpecSource {
  type: 'file'
  path: string
}

export interface UrlSpecSource {
  type: 'url'
  url: string
  headers?: Record<string, string>
}

export interface InlineSpecSource {
  type: 'inline'
  document: OpenAPIDocument
}

export type ApiSpecSource = FileSpecSource | UrlSpecSource | InlineSpecSource

export interface OperationOverride {
  title?: string
  description?: string
  badge?: string
  group?: string
  slug?: Array<string>
  hidden?: boolean
}

export interface ApiSpecConfig {
  id: string
  label: string
  description?: string
  version?: string
  source: ApiSpecSource
  tagsOrder?: Array<string>
  defaultGroup?: string
  webhookGroup?: string
  operationOverrides?: Record<string, OperationOverride>
  /**
   * Bound to a hidden tab: pages whose `openapi:` frontmatter names the spec
   * render its operations, but it gets no `/api/<id>/...` pages, search
   * entries or sitemap URLs of its own.
   */
  pageOnly?: boolean
}

export interface ApiReferenceConfig {
  specs: Array<ApiSpecConfig>
  defaultSpecId: string
}

export interface ResolvedSpec {
  config: ApiSpecConfig
  document: OpenAPIDocument
}

export interface NormalizedServer {
  url: string
  description?: string
}

export interface NormalizedExample {
  key: string
  summary?: string
  description?: string
  value: unknown
}

export interface NormalizedMediaType {
  mediaType: string
  schema?: Record<string, unknown>
  example?: unknown
  examples: Array<NormalizedExample>
}

export interface NormalizedParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required: boolean
  description?: string
  schema?: Record<string, unknown>
}

export interface NormalizedRequestBody {
  description?: string
  required: boolean
  contents: Array<NormalizedMediaType>
}

export interface NormalizedResponse {
  code: string
  description?: string
  contents: Array<NormalizedMediaType>
}

export interface NormalizedSecurityRequirement {
  name: string
  scopes: Array<string>
}

export interface NormalizedOperation {
  specId: string
  id: string
  key: string
  slug?: Array<string>
  title: string
  description?: string
  method: string
  path: string
  isWebhook: boolean
  group: string
  badge?: string
  tags: Array<string>
  servers: Array<NormalizedServer>
  parameters: Record<'path' | 'query' | 'header' | 'cookie', Array<NormalizedParameter>>
  requestBody?: NormalizedRequestBody
  responses: Array<NormalizedResponse>
  security: Array<Array<NormalizedSecurityRequirement>>
  /** Authored `x-codeSamples` / `x-code-samples`; shown before the generated samples. */
  codeSamples?: Array<{ label: string; source: string }>
  hidden?: boolean
  prefill: OperationPrefill
  /**
   * Set only on synthetic operations built from a manual `api:` page: the page
   * id the Try It relay re-derives the operation from, server-side.
   */
  manualPage?: string
  /** Locale the manual page was rendered from; absent for the default locale. */
  manualLocale?: string
}

export interface OperationPrefill {
  path: Record<string, string>
  query: Record<string, string>
  header: Record<string, string>
  cookie: Record<string, string>
  body?: string
}

export interface NormalizedSpec {
  config: ApiSpecConfig
  servers: Array<NormalizedServer>
  operations: Array<NormalizedOperation>
}

