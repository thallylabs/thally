import type {
  ApiSpecConfig,
  NormalizedMediaType,
  NormalizedOperation,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  NormalizedSecurityRequirement,
  NormalizedServer,
  NormalizedSpec,
  OperationOverride,
  ResolvedSpec,
} from '@/lib/openapi/types'
import { getApiPlaygroundCredentials } from '@/data/docs'

type RawObject = Record<string, unknown>

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const

export function buildOperationKey(method: string, path: string, isWebhook = false) {
  const prefix = isWebhook ? 'WEBHOOK ' : ''
  return `${prefix}${method.toUpperCase()} ${path}`
}

export function normalizeSpec(resolved: ResolvedSpec): NormalizedSpec {
  const specServers = normalizeServers((resolved.document as RawObject).servers)
  const resolveRef = createSchemaResolver(resolved.document as RawObject)
  const securitySchemes = (resolved.document as RawObject).components as RawObject | undefined
  const rawSecuritySchemes =
    securitySchemes && typeof securitySchemes.securitySchemes === 'object'
      ? (securitySchemes.securitySchemes as Record<string, RawObject>)
      : {}
  const operations: Array<NormalizedOperation> = []

  const paths = (resolved.document as RawObject).paths
  if (paths && typeof paths === 'object') {
    Object.entries(paths as Record<string, RawObject>).forEach(([pathKey, pathItem]) => {
      const pathParameters = extractParameters(pathItem.parameters)
      const pathServers = normalizeServers(pathItem.servers)

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation || typeof operation !== 'object') {
          continue
        }
        operations.push(
          normalizeOperation({
            specId: resolved.config.id,
            path: pathKey,
            method,
            rawOperation: operation as RawObject,
            sharedParameters: pathParameters,
            pathServers,
            specServers,
            config: resolved.config,
            documentSecurity: (resolved.document as RawObject).security,
            securitySchemes: rawSecuritySchemes,
            isWebhook: false,
            resolveRef,
          }),
        )
      }
    })
  }

  const webhooks = (resolved.document as RawObject).webhooks
  if (webhooks && typeof webhooks === 'object') {
    Object.entries(webhooks as Record<string, RawObject>).forEach(([webhookKey, webhookItem]) => {
      const hookParameters = extractParameters(webhookItem.parameters)
      const hookServers = normalizeServers(webhookItem.servers)
      for (const method of HTTP_METHODS) {
        const operation = webhookItem[method]
        if (!operation || typeof operation !== 'object') {
          continue
        }
        operations.push(
          normalizeOperation({
            specId: resolved.config.id,
            path: webhookKey,
            method,
            rawOperation: operation as RawObject,
            sharedParameters: hookParameters,
            pathServers: hookServers,
            specServers,
            config: resolved.config,
            documentSecurity: (resolved.document as RawObject).security,
            securitySchemes: rawSecuritySchemes,
            isWebhook: true,
            resolveRef,
          }),
        )
      }
    })
  }

  operations.sort((a, b) => {
    if (a.group === b.group) {
      return a.title.localeCompare(b.title)
    }
    return a.group.localeCompare(b.group)
  })

  return {
    config: resolved.config,
    servers: specServers,
    operations,
  }
}

interface NormalizeOperationOptions {
  specId: string
  path: string
  method: (typeof HTTP_METHODS)[number]
  rawOperation: RawObject
  sharedParameters: Array<RawObject>
  pathServers: Array<NormalizedServer>
  specServers: Array<NormalizedServer>
  documentSecurity?: unknown
  securitySchemes: Record<string, RawObject>
  config: ApiSpecConfig
  isWebhook: boolean
  resolveRef: (ref: string) => RawObject | null
}

function normalizeOperation(options: NormalizeOperationOptions): NormalizedOperation {
  const method = options.method.toUpperCase()
  const key = buildOperationKey(method, options.path, options.isWebhook)
  const override = options.config.operationOverrides?.[key]
  const title = override?.title ?? (options.rawOperation.summary as string | undefined) ?? (options.rawOperation.operationId as string | undefined) ?? `${method} ${options.path}`
  const description =
    override?.description ??
    (options.rawOperation.description as string | undefined) ??
    (options.rawOperation.summary as string | undefined)
  const tags = Array.isArray(options.rawOperation.tags)
    ? (options.rawOperation.tags.filter((tag): tag is string => typeof tag === 'string') as Array<string>)
    : []
  const group = resolveGroup({ tags, override, config: options.config, isWebhook: options.isWebhook })

  const pathLevelParameters = options.sharedParameters
  const operationParameters = extractParameters(options.rawOperation.parameters)
  const { groupedParameters, parameterPrefill } = normalizeParameters([...pathLevelParameters, ...operationParameters], options.resolveRef)
  const { body: requestBody, sample: requestBodySample } = normalizeRequestBody(options.rawOperation.requestBody, options.resolveRef)
  const responses = normalizeResponses(options.rawOperation.responses, options.resolveRef)
  const security = normalizeSecurity(options.rawOperation.security ?? options.documentSecurity)
  const headerPrefill = applySecurityAuthPrefill(
    security,
    options.securitySchemes,
    options.resolveRef,
    { ...parameterPrefill.header },
  )

  const operationServers = normalizeServers(options.rawOperation.servers)
  const servers =
    operationServers.length > 0
      ? operationServers
      : options.pathServers.length > 0
        ? options.pathServers
        : options.specServers

  const slug = override?.slug ?? buildSlugSegments(options.path, method, options.isWebhook)
  const id = buildOperationId(options.specId, slug, options.isWebhook)

  return {
    specId: options.specId,
    id,
    key,
    slug,
    title,
    description,
    method,
    path: options.path,
    isWebhook: options.isWebhook,
    group,
    badge: override?.badge,
    tags,
    servers,
    parameters: groupedParameters,
    requestBody,
    responses,
    security,
    hidden: override?.hidden ?? false,
    prefill: {
      path: parameterPrefill.path,
      query: parameterPrefill.query,
      header: headerPrefill,
      cookie: parameterPrefill.cookie,
      body: requestBodySample,
    },
  }
}

function normalizeServers(raw: unknown): Array<NormalizedServer> {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((server) => (server && typeof server === 'object' ? server : null))
    .filter((server): server is RawObject => Boolean(server && typeof server.url === 'string'))
    .map((server) => ({
      url: String(server.url),
      description: typeof server.description === 'string' ? server.description : undefined,
    }))
}

function extractParameters(raw: unknown): Array<RawObject> {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((param): param is RawObject => param !== null && typeof param === 'object')
}

function normalizeParameters(
  params: Array<RawObject>,
  resolveRef: (ref: string) => RawObject | null,
): {
  groupedParameters: Record<'path' | 'query' | 'header' | 'cookie', Array<NormalizedParameter>>
  parameterPrefill: Record<'path' | 'query' | 'header' | 'cookie', Record<string, string>>
} {
  const grouped: Record<'path' | 'query' | 'header' | 'cookie', Array<NormalizedParameter>> = {
    path: [],
    query: [],
    header: [],
    cookie: [],
  }
  const prefill: Record<'path' | 'query' | 'header' | 'cookie', Record<string, string>> = {
    path: {},
    query: {},
    header: {},
    cookie: {},
  }

  const deduped = new Map<string, RawObject>()
  params.forEach((param) => {
    if (typeof param.name !== 'string' || typeof param.in !== 'string') {
      return
    }
    const key = `${param.in}:${param.name}`
    if (!deduped.has(key)) {
      deduped.set(key, param)
    }
  })

  deduped.forEach((param) => {
    const location = param.in
    if (location === 'path' || location === 'query' || location === 'header' || location === 'cookie') {
      const normalizedParameter: NormalizedParameter = {
        name: param.name as string,
        in: location,
        required: Boolean(param.required),
        description: typeof param.description === 'string' ? param.description : undefined,
        schema: typeof param.schema === 'object' ? (param.schema as Record<string, unknown>) : undefined,
      }
      grouped[location].push(normalizedParameter)
      prefill[location][normalizedParameter.name] = buildParameterSampleValue(normalizedParameter.schema, resolveRef, normalizedParameter.required)
    }
  })

  return {
    groupedParameters: grouped,
    parameterPrefill: prefill,
  }
}

function normalizeRequestBody(
  raw: unknown,
  resolveRef: (ref: string) => RawObject | null,
): {
  body?: NormalizedRequestBody
  sample?: string
} {
  if (!raw || typeof raw !== 'object') {
    return { body: undefined, sample: undefined }
  }
  const contents = normalizeContent((raw as RawObject).content, resolveRef)
  if (!contents.length) {
    return { body: undefined, sample: undefined }
  }
  const primaryContent = contents[0]
  const sampleValue = primaryContent?.schema ? buildSchemaExample(primaryContent.schema, resolveRef) : undefined
  const sample = sampleValue !== undefined ? JSON.stringify(sampleValue, null, 2) : undefined

  return {
    body: {
      description: typeof (raw as RawObject).description === 'string' ? ((raw as RawObject).description as string) : undefined,
      required: Boolean((raw as RawObject).required),
      contents,
    },
    sample,
  }
}

function normalizeResponses(raw: unknown, resolveRef: (ref: string) => RawObject | null): Array<NormalizedResponse> {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  return Object.entries(raw as Record<string, RawObject>)
    .map(([code, response]) => {
      // Responses can also be $refs (e.g. '#/components/responses/NotFound')
      const resolved = typeof response.$ref === 'string' ? (resolveRef(response.$ref) ?? response) : response
      return {
        code,
        description: typeof resolved.description === 'string' ? resolved.description : undefined,
        contents: normalizeContent(resolved.content, resolveRef),
      }
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
}

function normalizeContent(raw: unknown, resolveRef: (ref: string) => RawObject | null): Array<NormalizedMediaType> {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  return Object.entries(raw as Record<string, RawObject>).map(([mediaType, definition]) => {
    let schema = typeof definition.schema === 'object' ? (definition.schema as Record<string, unknown>) : undefined
    // Deep-resolve all $refs in the schema tree so the renderer sees plain objects
    if (schema) {
      schema = deepResolveRefs(schema, resolveRef)
    }
    return {
      mediaType,
      schema,
      example: definition.example,
      examples: normalizeExamples(definition.examples),
    }
  })
}

/**
 * Recursively walks a schema object and resolves every $ref pointer it finds,
 * including refs inside properties, items, allOf/anyOf/oneOf members, and any
 * further nesting. Circular references are broken by tracking visited $ref paths.
 */
function deepResolveRefs(
  schema: Record<string, unknown>,
  resolveRef: (ref: string) => RawObject | null,
  seen = new Set<string>(),
): Record<string, unknown> {
  // If this node IS a $ref, resolve it first (then recurse into the result)
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) {
      // Break circular reference — return a placeholder
      return { type: 'object', description: `[Circular: ${schema.$ref.split('/').pop()}]` }
    }
    const resolved = resolveRef(schema.$ref)
    if (resolved) {
      const childSeen = new Set(seen)
      childSeen.add(schema.$ref)
      return deepResolveRefs(resolved, resolveRef, childSeen)
    }
    return schema
  }

  const result: Record<string, unknown> = { ...schema }

  // Resolve allOf / anyOf / oneOf members
  for (const compositeKey of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[compositeKey])) {
      result[compositeKey] = (schema[compositeKey] as unknown[]).map((item) =>
        item && typeof item === 'object' ? deepResolveRefs(item as RawObject, resolveRef, seen) : item,
      )
    }
  }

  // Resolve each property schema
  if (schema.properties && typeof schema.properties === 'object') {
    const resolvedProps: Record<string, unknown> = {}
    for (const [propKey, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      resolvedProps[propKey] =
        propSchema && typeof propSchema === 'object'
          ? deepResolveRefs(propSchema as RawObject, resolveRef, seen)
          : propSchema
    }
    result.properties = resolvedProps
  }

  // Resolve array items
  if (schema.items && typeof schema.items === 'object') {
    result.items = deepResolveRefs(schema.items as RawObject, resolveRef, seen)
  }

  return result
}

function normalizeExamples(raw: unknown): Array<{ key: string; summary?: string; description?: string; value: unknown }> {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  return Object.entries(raw as Record<string, RawObject>)
    .map(([key, example]) => ({
      key,
      summary: typeof example.summary === 'string' ? example.summary : undefined,
      description: typeof example.description === 'string' ? example.description : undefined,
      value: 'value' in example ? example.value : example,
    }))
    .filter((example) => example.value !== undefined)
}

function normalizeSecurity(raw: unknown): Array<Array<NormalizedSecurityRequirement>> {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((requirement) => {
      if (!requirement || typeof requirement !== 'object') {
        return null
      }
      return Object.entries(requirement as Record<string, unknown>)
        .map(([name, scopes]) => ({
          name,
          scopes: Array.isArray(scopes) ? (scopes.filter((scope): scope is string => typeof scope === 'string') as Array<string>) : [],
        }))
        .filter((entry) => entry.name.length > 0)
    })
    .filter((group): group is Array<NormalizedSecurityRequirement> => Array.isArray(group) && group.length > 0)
}

function resolveSecurityScheme(
  schemes: Record<string, RawObject>,
  name: string,
  resolveRef: (ref: string) => RawObject | null,
): RawObject | null {
  const scheme = schemes[name]
  if (!scheme) return null
  if (typeof scheme.$ref === 'string') {
    const ref = scheme.$ref as string
    const parts = ref.split('/')
    const refName = parts[parts.length - 1]
    return schemes[refName] ?? resolveRef(ref)
  }
  return scheme
}

function applySecurityAuthPrefill(
  security: Array<Array<NormalizedSecurityRequirement>>,
  securitySchemes: Record<string, RawObject>,
  resolveRef: (ref: string) => RawObject | null,
  headerPrefill: Record<string, string>,
): Record<string, string> {
  const credentials = getApiPlaygroundCredentials()
  const result = { ...headerPrefill }

  for (const requirementGroup of security) {
    for (const requirement of requirementGroup) {
      const scheme = resolveSecurityScheme(securitySchemes, requirement.name, resolveRef)
      if (!scheme) continue

      const configured = credentials[requirement.name]
      const type = scheme.type as string | undefined

      if (type === 'http' && scheme.scheme === 'bearer') {
        const token = configured ?? 'YOUR_API_KEY'
        result.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`
      } else if (type === 'apiKey' && scheme.in === 'header' && typeof scheme.name === 'string') {
        result[scheme.name as string] = configured ?? 'YOUR_API_KEY'
      } else if (type === 'http' && scheme.scheme === 'basic') {
        result.Authorization = configured ? `Basic ${configured}` : 'Basic YOUR_BASE64_CREDENTIALS'
      }
    }
    break
  }

  return result
}

function resolveGroup({
  tags,
  override,
  config,
  isWebhook,
}: {
  tags: Array<string>
  override?: OperationOverride
  config: ApiSpecConfig
  isWebhook: boolean
}) {
  if (override?.group) {
    return override.group
  }
  if (isWebhook) {
    return config.webhookGroup ?? 'Webhooks'
  }
  if (config.tagsOrder?.length) {
    const target = config.tagsOrder
      .map((tag) => tag.toLowerCase())
      .find((orderedTag) => tags.some((operationTag) => operationTag.toLowerCase() === orderedTag))
    if (target) {
      return tags.find((tag) => tag.toLowerCase() === target) ?? target
    }
  }
  if (tags.length > 0) {
    return tags[0]
  }
  return config.defaultGroup ?? 'Endpoints'
}

function buildSlugSegments(path: string, method: string, isWebhook: boolean): Array<string> {
  const cleaned = path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').toLowerCase())

  if (!cleaned.length) {
    cleaned.push('root')
  }

  if (isWebhook && cleaned[0] !== 'webhooks') {
    cleaned.unshift('webhooks')
  }

  cleaned.push(method.toLowerCase())
  return cleaned
}

function buildOperationId(specId: string, slug: Array<string>, isWebhook: boolean) {
  const prefix = isWebhook ? 'webhook' : 'endpoint'
  return [prefix, specId, ...slug].join('-').replace(/-+/g, '-')
}

function createSchemaResolver(document: RawObject) {
  return function resolveRef(ref: string): RawObject | null {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) {
      return null
    }
    const pathSegments = ref
      .slice(2)
      .split('/')
      .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))

    let current: unknown = document
    for (const segment of pathSegments) {
      if (!current || typeof current !== 'object' || !(segment in (current as Record<string, unknown>))) {
        return null
      }
      current = (current as Record<string, unknown>)[segment]
    }
    return current && typeof current === 'object' ? (current as RawObject) : null
  }
}

function buildSchemaExample(schema: RawObject | undefined, resolveRef: (ref: string) => RawObject | null, seen = new Set<string>()): unknown {
  if (!schema) {
    return undefined
  }
  if (schema.example !== undefined) {
    return schema.example
  }
  if (schema.default !== undefined) {
    return schema.default
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }
  if (typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) {
      return undefined
    }
    seen.add(schema.$ref)
    const resolved = resolveRef(schema.$ref)
    if (resolved) {
      return buildSchemaExample(resolved, resolveRef, seen)
    }
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce<unknown>((acc, fragment) => {
      const sample = fragment && typeof fragment === 'object' ? buildSchemaExample(fragment as RawObject, resolveRef, new Set(seen)) : undefined
      if (Array.isArray(acc) || Array.isArray(sample)) {
        return sample ?? acc
      }
      if (typeof acc === 'object' && acc !== null && typeof sample === 'object' && sample !== null) {
        return { ...(acc as RawObject), ...(sample as RawObject) }
      }
      return sample ?? acc
    }, {})
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (type === 'object' || schema.properties) {
    const properties = schema.properties && typeof schema.properties === 'object' ? (schema.properties as Record<string, RawObject>) : {}
    const result: Record<string, unknown> = {}
    Object.entries(properties).forEach(([key, value]) => {
      result[key] = buildSchemaExample(value, resolveRef, new Set(seen)) ?? ''
    })
    return result
  }
  if (type === 'array' && schema.items && typeof schema.items === 'object') {
    const sampleItem = buildSchemaExample(schema.items as RawObject, resolveRef, new Set(seen))
    return sampleItem !== undefined ? [sampleItem] : []
  }
  if (type === 'boolean') {
    return true
  }
  if (type === 'integer' || type === 'number') {
    return 0
  }
  return ''
}

function buildParameterSampleValue(
  schema: Record<string, unknown> | undefined,
  resolveRef: (ref: string) => RawObject | null,
  required: boolean,
): string {
  const value = schema ? buildSchemaExample(schema, resolveRef) : undefined
  if (value === undefined || value === null) {
    return required ? 'required-value' : ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

