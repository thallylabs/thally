import { useCallback, useMemo, useState } from 'react'
import type { NormalizedOperation } from '@/lib/openapi/types'

export interface TryItController {
  operation: NormalizedOperation
  serverUrl: string
  setServerUrl: (url: string) => void
  pathParams: Record<string, string>
  queryParams: Record<string, string>
  headerParams: Record<string, string>
  bodyValue: string
  setBodyValue: (value: string) => void
  setParamValue: (group: 'path' | 'query' | 'header', key: string, value: string) => void
  preparedRequest: PreparedRequest
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
  curlLines: Array<string>
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
  const [response, setResponse] = useState<ResponsePayload | { error: string } | null>(null)
  const [isSending, setIsSending] = useState(false)

  const canSendBody = !['GET', 'HEAD'].includes(operation.method.toUpperCase())
  const isServerConfigured = Boolean(serverUrl)

  const buildResolvedUrl = useCallback(() => {
    const populatedPath = operation.path.replace(/{([^}]+)}/g, (_match, key) => {
      const value = pathParams[key] ?? `{${key}}`
      return encodeURIComponent(value)
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

  const preparedRequest = useMemo<PreparedRequest>(() => {
    const url = isServerConfigured ? buildResolvedUrl() : ''
    const curlLines = buildCurlCommand(operation.method, url, headerParams, canSendBody ? bodyValue : undefined)
    return {
      url,
      method: operation.method,
      headers: headerParams,
      body: canSendBody ? bodyValue : undefined,
      isServerConfigured,
      curlLines,
    }
  }, [buildResolvedUrl, headerParams, operation.method, canSendBody, bodyValue, isServerConfigured])

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
      setResponse({ error: 'No server URL available for this spec. Update your OpenAPI servers array.' })
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
  }, [preparedRequest])

  return {
    operation,
    serverUrl,
    setServerUrl,
    pathParams,
    queryParams,
    headerParams,
    bodyValue,
    setBodyValue,
    setParamValue,
    preparedRequest,
    response,
    sendRequest,
    isSending,
    canSendBody,
  }
}

function buildCurlCommand(method: string, url: string, headers: Record<string, string>, body?: string) {
  if (!url) {
    return []
  }
  const lines = [`curl --request ${method.toUpperCase()} \\`, `  --url '${url}'`]
  Object.entries(headers)
    .filter(([, value]) => Boolean(value))
    .forEach(([key, value]) => {
      lines.push(`  -H '${key}: ${value}'`)
    })
  if (body) {
    lines.push(`  --data '${body.replace(/'/g, `'"'"'`)}'`)
  }
  return lines
}

