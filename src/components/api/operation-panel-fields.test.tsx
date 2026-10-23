import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OperationPanel } from '@/components/api/operation-panel'
import { operationFrom } from '@/components/api/test-fixtures'

const render = (operation: Record<string, unknown>) =>
  renderToStaticMarkup(
    <OperationPanel
      operation={operationFrom({
        openapi: '3.0.1',
        info: { title: 'T', version: '1' },
        servers: [{ url: 'https://api.example.com' }],
        paths: { '/things/{email}': { post: { summary: 'Thing', responses: {}, ...operation } } },
      })}
    />,
  )

describe('parameter rows', () => {
  it('show the description that sits on the parameter schema', () => {
    const html = render({
      parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', description: 'The email of the user invited.' } }],
    })
    expect(html).toContain('The email of the user invited.')
  })

  it('prefer the parameter description over the schema one', () => {
    const html = render({
      parameters: [{ name: 'email', in: 'path', required: true, description: 'Parameter text.', schema: { type: 'string', description: 'Schema text.' } }],
    })
    expect(html).toContain('Parameter text.')
    expect(html).not.toContain('Schema text.')
  })
})
