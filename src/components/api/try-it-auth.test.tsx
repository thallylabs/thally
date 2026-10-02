import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { TryItPanel } from '@/components/api/try-it-panel'
import { operationFrom } from '@/components/api/test-fixtures'
import type { TryItController } from '@/components/api/use-try-it-controller'

const document = {
  openapi: '3.1.0',
  info: { title: 'T', version: '1' },
  servers: [{ url: 'https://api.example.com/v2' }],
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: { '/scrape': { post: { summary: 'Scrape', responses: { '200': { description: 'ok' } } } } },
}

describe('Authorizations', () => {
  it('lists the Authorization header as a required string with the Bearer wording, not an OAuth scopes block', () => {
    const html = renderToStaticMarkup(<OperationPanel operation={operationFrom(document)} />)
    expect(html).toContain('Authorizations')
    expect(html).toContain('Bearer authentication header of the form')
    expect(html).not.toContain('No scopes required')
    expect(html).not.toContain('One of the following')
  })

  it('shows a password-type token input with no prefilled value in the playground', () => {
    const operation = operationFrom(document)
    const controller = {
      operation, serverUrl: '', setServerUrl: () => {}, pathParams: {}, queryParams: {}, headerParams: {}, bodyValue: '', setBodyValue: () => {},
      authValues: {}, setAuthValue: () => {}, setParamValue: () => {}, preparedRequest: { url: '', method: 'POST', headers: {}, isServerConfigured: false },
      response: null, sendRequest: async () => {}, isSending: false, canSendBody: true,
    } as unknown as TryItController
    const html = renderToStaticMarkup(<TryItPanel controller={controller} variant="dialog" />)
    expect(html).toMatch(/<input[^>]*type="password"[^>]*value=""/)
    expect(html).toContain('Bearer')
    expect(html).not.toContain('YOUR_API_KEY')
  })
})
