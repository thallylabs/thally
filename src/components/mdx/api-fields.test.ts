/** Compatibility coverage for authored and generated API-field metadata. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Expandable, ParamField, ResponseField } from '@/components/mdx/api-fields'

describe('API field components', () => {
  it('accepts Mintlify string location props and legacy boolean locations', () => {
    const canonical = renderToStaticMarkup(createElement(ParamField, {
      query: 'limit', type: 'integer', default: 20, placeholder: '25', deprecated: true,
    }, 'Maximum rows.'))
    const legacy = renderToStaticMarkup(createElement(ParamField, {
      path: true, name: 'petId', required: true,
    }))

    expect(canonical).toContain('limit')
    expect(canonical).toContain('placeholder')
    expect(canonical).toContain('deprecated')
    expect(legacy).toContain('petId')
    expect(legacy).toContain('required')
  })

  it('renders response labels and accessible expandable state', () => {
    const response = renderToStaticMarkup(createElement(ResponseField, {
      name: 'status', type: 'string', pre: ['read-only'], post: ['enum'], deprecated: true,
    }))
    const expandable = renderToStaticMarkup(createElement(Expandable, {
      title: 'Child fields', defaultOpen: true,
    }, 'Nested content'))

    expect(response).toContain('read-only')
    expect(response).toContain('enum')
    expect(expandable).toContain('aria-expanded="true"')
    expect(expandable).toContain('Nested content')
  })
})
