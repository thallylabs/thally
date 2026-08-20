/**
 * Regression coverage for the shared Callout surface and MDX aliases.
 */

import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Note, type NoteType } from '@/components/mdx/note'
import { useMDXComponents } from '@/components/mdx/mdx-components'

const RenderableNote = Note as ComponentType<{
  type?: NoteType
  children?: ReactNode
}>

function renderCallout(type: NoteType): string {
  return renderToStaticMarkup(createElement(RenderableNote, { type }, 'Callout content'))
}

describe('Note', () => {
  it.each<NoteType>(['note', 'tip', 'info', 'warning', 'check', 'danger'])(
    'renders the %s tone as a complete tinted surface',
    (type) => {
      const markup = renderCallout(type)

      expect(markup).toContain(`data-callout="${type}"`)
      expect(markup).toContain('rounded-xl')
      expect(markup).toContain('border')
      expect(markup).toMatch(/bg-(?:accent|teal|sky|amber|emerald|rose)/)
      expect(markup).not.toContain('border-l-2')
    },
  )

  it('uses the live brand accent for the default Note surface', () => {
    const markup = renderCallout('note')

    expect(markup).toContain('border-accent/45')
    expect(markup).toContain('bg-accent/[0.14]')
    expect(markup).toContain('text-accent')
    expect(markup).toContain('thally-callout-content')
  })

  it.each([
    ['Check', 'check'],
    ['Danger', 'danger'],
  ] as const)('exposes the %s MDX alias', (name, tone) => {
    const components = useMDXComponents({})
    const Component = components[name] as ComponentType<{ children?: ReactNode }>
    const markup = renderToStaticMarkup(createElement(Component, null, 'Alias content'))

    expect(markup).toContain(`data-callout="${tone}"`)
  })

  it.each([
    ['tip', 'tip'],
    ['success', 'check'],
    ['error', 'danger'],
  ] as const)('maps generic Callout type="%s" to the %s tone', (type, tone) => {
    const components = useMDXComponents({})
    const Callout = components.Callout as ComponentType<{
      type?: string
      children?: ReactNode
    }>
    const markup = renderToStaticMarkup(
      createElement(Callout, { type }, 'Generic callout content'),
    )

    expect(markup).toContain(`data-callout="${tone}"`)
  })
})
