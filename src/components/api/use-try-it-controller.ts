import { useCallback, useMemo, useState } from 'react'
import { authHeaders } from '@/lib/openapi/auth'
import type { NormalizedOperation } from '@/lib/openapi/types'

export { buildCurlCommand } from '@/lib/openapi/code-samples'

export const MANUAL_NO_SERVER = 'No server URL for this page. Set api.mdx.server in docs.json or use a full URL in the api frontmatter.'

export interface TryItController {
  operation: NormalizedOperation
  serverUrl: string
  setServerUrl: (url: string) => void
  pathParams: Record<string, string>
  queryParams: Record<string, string>
  headerParams: Record<string, string>
  bodyValue: string
  setBodyValue: (value: string) => void
  /** Typed credential per security scheme name; never stored, only sent with this request. */
  authValues: Record<string, string>
  setAuthValue: (scheme: string, value: string) => void
  setParamValue: (group: 'path' | 'query' | 'header', key: string, value: string) => void
  preparedRequest: PreparedRequest
  /** The request as shown in code samples: a missing credential reads `<token>`. */
  sampleRequest: PreparedRequest
  response: ResponsePayload | { error: string } | null
  sendRequest: () => Promise<void>
  isSending: boolean
  canSendBody: boolean
}

export interface PreparedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  isServerConfigured: boolean
}

export interface ResponsePayload {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
}

export function useTryItController(operation: NormalizedOperation): TryItController {
  const [serverUrl, setServerUrl] = useState(operation.servers[0]?.url ?? '')
  const [pathParams, setPathParams] = useState<Record<string, string>>(operation.prefill.path)
  const [queryParams, setQueryParams] = useState<Record<string, string>>(operation.prefill.query)
  const [headerParams, setHeaderParams] = useState<Record<string, string>>(operation.prefill.header)
  const [bodyValue, setBodyValue] = useState(operation.prefill.body ?? '')
  const [authValues, setAuthValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(operation.authSchemes.flatMap((scheme) => (scheme.prefill ? [[scheme.name, scheme.prefill]] : []))),
  )
  const [response, setResponse] = useState<ResponsePayload | { error: string } | null>(null)
  const [isSending, setIsSending] = useState(false)

  const canSendBody = !['GET', 'HEAD'].includes(operation.method.toUpperCase())
  const isServerConfigured = Boolean(serverUrl)

  const buildResolvedUrl = useCallback(() => {
    const populatedPath = operation.path.replace(/{([^}]+)}/g, (_match, key) => {
      // An empty path value keeps its visible `{name}` placeholder instead of
      // silently turning `/monitor/{id}` into the list endpoint `/monitor/`.
      const value = pathParams[key]
      return value ? encodeURIComponent(value) : `{${key}}`
    })
    const searchParams = new URLSearchParams()
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value) {
        searchParams.append(key, value)
      }
    })
    const queryString = searchParams.toString()
    const base = serverUrl?.replace(/\/$/, '') ?? ''
    return `${base}${populatedPath.startsWith('/') ? populatedPath : `/${populatedPath}`}${queryString ? `?${queryString}` : ''}`
  }, [operation.path, pathParams, queryParams, serverUrl])

  const buildRequest = useCallback(
    (placeholders: boolean): PreparedRequest => {
      const url = isServerConfigured ? buildResolvedUrl() : ''
      const body = canSendBody && bodyValue ? bodyValue : undefined
      const mediaType = operation.requestBody?.contents[0]?.mediaType
      const withAuth = { ...headerParams, ...authHeaders(operation.authSchemes, authValues, placeholders) }
      const headers =
        body && mediaType && !Object.keys(withAuth).some((key) => key.toLowerCase() === 'content-type')
          ? { ...withAuth, 'Content-Type': mediaType }
          : withAuth
      return { url, method: operation.method, headers, body: canSendBody ? bodyValue : undefined, isServerConfigured }
    },
    [authValues, buildResolvedUrl, headerParams, operation.authSchemes, operation.method, operation.requestBody?.contents, canSendBody, bodyValue, isServerConfigured],
  )
  const preparedRequest = useMemo(() => buildRequest(false), [buildRequest])
  const sampleRequest = useMemo(() => buildRequest(true), [buildRequest])

  const setAuthValue = useCallback((scheme: string, value: string) => setAuthValues((prev) => ({ ...prev, [scheme]: value })), [])

  const setParamValue = useCallback(
    (group: 'path' | 'query' | 'header', key: string, value: string) => {
      const setter =
        group === 'path'
          ? setPathParams
          : group === 'query'
            ? setQueryParams
            : setHeaderParams

      setter((prev) => ({
        ...prev,
        [key]: value,
      }))
    },
    [],
  )

  const sendRequest = useCallback(async () => {
    if (!preparedRequest.isServerConfigured) {
      setResponse({ error: operation.manualPage ? MANUAL_NO_SERVER : 'No server URL available for this spec. Update your OpenAPI servers array.' })
      return
    }
    setIsSending(true)
    setResponse(null)
    try {
      const res = await fetch('/api/try-it', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          specId: operation.specId,
          ...(operation.manualPage ? { page: operation.manualPage } : {}),
          ...(operation.manualLocale ? { locale: operation.manualLocale } : {}),
          operationPath: operation.path,
          url: preparedRequest.url,
          method: preparedRequest.method,
          headers: preparedRequest.headers,
          body: preparedRequest.body,
        }),
      })
      const payload = (await res.json()) as ResponsePayload | { error: string }
      setResponse(payload)
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : 'Failed to execute request' })
    } finally {
      setIsSending(false)
    }
  }, [operation.manualLocale, operation.manualPage, operation.path, operation.specId, preparedRequest])

  return {
    operation,
    serverUrl,
    setServerUrl,
    pathParams,
    queryParams,
    headerParams,
    bodyValue,
    setBodyValue,
    authValues,
    setAuthValue,
    setParamValue,
    preparedRequest,
    sampleRequest,
    response,
    sendRequest,
    isSending,
    canSendBody,
  }
}
