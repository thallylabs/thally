import { NextResponse, type NextRequest } from 'next/server'

const BLOCKED_HEADERS = new Set(['host', 'connection', 'content-length'])

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    method?: string
    url?: string
    headers?: Record<string, string>
    body?: string
  }

  if (!payload?.url || !payload?.method) {
    return NextResponse.json({ error: 'Missing url or method' }, { status: 400 })
  }

  if (!/^https?:\/\//i.test(payload.url)) {
    return NextResponse.json({ error: 'Only HTTP(S) requests are allowed' }, { status: 400 })
  }

  const method = payload.method.toUpperCase()
  const headers = Object.entries(payload.headers ?? {}).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!value || BLOCKED_HEADERS.has(key.toLowerCase())) {
      return acc
    }
    acc[key] = value
    return acc
  }, {})

  const controller = new AbortController()
  const startedAt = Date.now()

  try {
    const response = await fetch(payload.url, {
      method,
      headers,
      body: shouldIncludeBody(method) ? payload.body ?? undefined : undefined,
      signal: controller.signal,
    })

    const textBody = await response.text()
    const duration = Date.now() - startedAt

    return NextResponse.json(
      {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: textBody,
        duration,
      },
      { status: 200 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function shouldIncludeBody(method: string) {
  return !['GET', 'HEAD'].includes(method.toUpperCase())
}

