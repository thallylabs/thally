import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { classifyRequest } from '@/lib/traffic-classifier'

function mockRequest(url: string, init?: { headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, { headers: init?.headers })
}

describe('classifyRequest', () => {
  it('classifies JSON format param as agent', () => {
    const result = classifyRequest(mockRequest('https://docs.example.com/guides/foo?format=json'), '/guides/foo')
    expect(result.visitorType).toBe('agent')
    expect(result.agentSignal).toBe('format_param')
  })

  it('classifies browser navigation as human', () => {
    const result = classifyRequest(
      mockRequest('https://docs.example.com/guides/foo', {
        headers: { rsc: '1' },
      }),
      '/guides/foo',
    )
    expect(result.visitorType).toBe('human')
  })

  it('classifies discovery paths as agent', () => {
    const result = classifyRequest(mockRequest('https://docs.example.com/llms.txt'), '/llms.txt')
    expect(result.visitorType).toBe('agent')
    expect(result.agentSignal).toBe('discovery_path')
  })

  it('separates ordinary crawlers from people and AI tools', () => {
    const result = classifyRequest(
      mockRequest('https://docs.example.com/guides/foo', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      }),
      '/guides/foo',
    )

    expect(result.visitorType).toBe('bot')
    expect(result.agentSignal).toBeUndefined()
  })

  it('does not turn an ordinary crawler into an AI visitor on discovery paths', () => {
    const result = classifyRequest(
      mockRequest('https://docs.example.com/llms.txt', {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      }),
      '/llms.txt',
    )

    expect(result.visitorType).toBe('bot')
  })

  it('keeps named AI crawlers in the AI audience', () => {
    const result = classifyRequest(
      mockRequest('https://docs.example.com/guides/foo', {
        headers: { 'user-agent': 'ClaudeBot/1.0' },
      }),
      '/guides/foo',
    )

    expect(result.visitorType).toBe('agent')
    expect(result.agentSignal).toBe('user_agent')
  })
})
