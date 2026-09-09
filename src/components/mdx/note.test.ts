/**
 * Regression coverage for the shared Callout surface and MDX aliases.
 *
 * The visual system is one hue per type, resolved in CSS from `data-callout`.
 * These tests pin the markup contract the stylesheet depends on: the tone
 * attribute, the layout attribute (solo vs titled vs body), the icon slot,
 * and the validated custom-colour variables.
 */

import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Note,
  isSingleLine,
  resolveNoteType,
  safeCalloutColor,
  type NoteProps,
  type NoteType,
} from '@/components/mdx/note'
import { useMDXComponents } from '@/components/mdx/mdx-components'

const RenderableNote = Note as ComponentType<Partial<NoteProps>>

function renderCallout(props: Partial<NoteProps>, children: ReactNode = 'Callout content'): string {
  return renderToStaticMarkup(createElement(RenderableNote, props, children))
}

function countSvgs(markup: string): number {
  return markup.match(/<svg/g)?.length ?? 0
}

describe('Note', () => {
  it.each<NoteType>(['note', 'tip', 'info', 'warning', 'check', 'danger'])(
    'renders the %s tone with the hooks the stylesheet keys on',
    (type) => {
      const markup = renderCallout({ type })

      expect(markup).toContain(`data-callout="${type}"`)
      expect(markup).toContain('thally-callout')
      expect(markup).toContain('thally-callout-content')
      expect(countSvgs(markup)).toBe(1)
      expect(markup).toContain('class="thally-callout-icon"')
    },
  )

  it('normalises authored type values through the alias map', () => {
    expect(renderCallout({ type: 'Warning' })).toContain('data-callout="warning"')
    expect(renderCallout({ type: ' success ' })).toContain('data-callout="check"')
    expect(renderCallout({ type: 'ERROR' })).toContain('data-callout="danger"')
    expect(renderCallout({ type: 'Warning' })).toContain('<svg')
  })

  it('falls back to content inference for unknown or unsafe type values', () => {
    expect(renderCallout({ type: 'caution' }, 'Plain sentence.')).toContain('data-callout="info"')
    expect(renderCallout({ type: 'constructor' }, 'Plain sentence.')).toContain('data-callout="info"')
    expect(renderCallout({ type: '__proto__' }, 'Plain sentence.')).toContain('data-callout="info"')
  })

  it('treats a single line of text as a solo callout that takes the hue', () => {
    expect(renderCallout({ type: 'tip' })).toContain('data-callout-layout="solo"')
    expect(renderCallout({ type: 'tip' }, createElement('p', null, 'Block-authored line'))).toContain(
      'data-callout-layout="solo"',
    )
    const InlineCode = ({ children }: { children?: ReactNode }) => createElement('code', null, children)
    const inlineAuthored = renderCallout({ type: 'tip' }, [
      'Run ',
      createElement(InlineCode, { key: 'code' }, 'thally check'),
      ' first',
    ])
    expect(inlineAuthored).toContain('data-callout-layout="solo"')
  })

  it('keeps multi-block content, lone components, and titled callouts in ink', () => {
    const body = renderCallout({ type: 'note' }, [
      createElement('p', { key: 'a' }, 'First paragraph'),
      createElement('p', { key: 'b' }, 'Second paragraph'),
    ])
    expect(body).toContain('data-callout-layout="body"')

    const list = renderCallout({ type: 'note' }, createElement('ul', null, createElement('li', null, 'Item')))
    expect(list).toContain('data-callout-layout="body"')

    const Widget = () => createElement('span', null, 'widget')
    expect(renderCallout({ type: 'note' }, createElement(Widget))).toContain('data-callout-layout="body"')

    const titled = renderCallout({ type: 'warning', title: 'Heads up' })
    expect(titled).toContain('data-callout-layout="titled"')
    expect(titled).toContain('<div class="thally-callout-title">Heads up</div>')
    expect(titled.indexOf('Heads up')).toBeLessThan(titled.indexOf('Callout content'))
  })

  it('renders a validated custom colour as theme variables on the root', () => {
    const markup = renderCallout({ color: '#C77DFF' })

    expect(markup).toContain('data-callout="custom"')
    expect(markup).toContain('data-callout-color="custom"')
    expect(markup).toContain('--co-light:#C77DFF')
    expect(markup).toContain('--co-dark:#C77DFF')
  })

  it('prefers colorDark for the dark slot when both colours are given', () => {
    const markup = renderCallout({ type: 'tip', color: 'rgb(26, 127, 55)', colorDark: '#5FD068' })

    expect(markup).toContain('data-callout="tip"')
    expect(markup).toContain('data-callout-color="custom"')
    expect(markup).toContain('--co-light:rgb(26, 127, 55)')
    expect(markup).toContain('--co-dark:#5FD068')
  })

  it('drops colours that are not plain CSS colour literals', () => {
    const markup = renderCallout({ color: 'red; background: url(https://evil.example/x)' })

    expect(markup).not.toContain('style=')
    expect(markup).not.toContain('data-callout-color')
    expect(markup).toContain('data-callout="info"')
  })

  it('renders an allowlisted icon name in place of the type glyph', () => {
    const markup = renderCallout({ type: 'note', icon: 'key' })

    expect(markup).toContain('data-icon-name="key"')
    expect(markup).toContain('thally-callout-icon')
    expect(countSvgs(markup)).toBe(1)
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
      type?: unknown
      children?: ReactNode
    }>
    const markup = renderToStaticMarkup(
      createElement(Callout, { type }, 'Generic callout content'),
    )

    expect(markup).toContain(`data-callout="${tone}"`)
  })

  it('survives non-string type attributes from migrated content', () => {
    const components = useMDXComponents({})
    const Callout = components.Callout as ComponentType<{ type?: unknown; children?: ReactNode }>

    for (const type of [true, 1, {}]) {
      const markup = renderToStaticMarkup(createElement(Callout, { type }, 'Plain sentence.'))
      expect(markup).toContain('data-callout="info"')
    }
  })

  it('passes icon and colour through the generic Callout', () => {
    const components = useMDXComponents({})
    const Callout = components.Callout as ComponentType<{
      icon?: string
      color?: string
      children?: ReactNode
    }>
    const markup = renderToStaticMarkup(
      createElement(Callout, { icon: 'key', color: '#C77DFF' }, 'This is a custom callout'),
    )

    expect(markup).toContain('data-callout="custom"')
    expect(markup).toContain('data-icon-name="key"')
    expect(markup).toContain('--co-light:#C77DFF')
  })

  it('still infers a danger tone for untyped migrated callouts', () => {
    const components = useMDXComponents({})
    const Callout = components.Callout as ComponentType<{ children?: ReactNode }>
    const markup = renderToStaticMarkup(
      createElement(Callout, null, 'Never expose this key in client code.'),
    )

    expect(markup).toContain('data-callout="danger"')
  })
})

describe('resolveNoteType', () => {
  it('maps tones and migration aliases case-insensitively', () => {
    expect(resolveNoteType('Note')).toBe('note')
    expect(resolveNoteType('success')).toBe('check')
    expect(resolveNoteType(' error ')).toBe('danger')
  })

  it('returns nothing for unknown, inherited, or non-string values', () => {
    expect(resolveNoteType('caution')).toBeUndefined()
    expect(resolveNoteType('constructor')).toBeUndefined()
    expect(resolveNoteType('__proto__')).toBeUndefined()
    expect(resolveNoteType(true)).toBeUndefined()
    expect(resolveNoteType(undefined)).toBeUndefined()
  })
})

describe('safeCalloutColor', () => {
  it.each(['#fff', '#C77DFF', '#c77dff80', 'rebeccapurple', 'hsl(280 60% 70%)', 'oklch(0.7 0.15 310)'])(
    'accepts %s',
    (value) => {
      expect(safeCalloutColor(` ${value} `)).toBe(value)
    },
  )

  it.each([
    '',
    'var(--x)',
    'url(https://evil.example)',
    '#12345',
    'red;color:blue',
    'expression(1)',
    'inherit',
    'none',
    'currentColor',
    'transparent',
  ])('rejects %s', (value) => {
    expect(safeCalloutColor(value)).toBeUndefined()
  })
})

describe('isSingleLine', () => {
  it('accepts one string, one paragraph, or text with inline elements', () => {
    expect(isSingleLine('One line')).toBe(true)
    expect(isSingleLine(['\n', createElement('p', null, 'One line'), '\n'])).toBe(true)
    expect(isSingleLine(['See ', createElement('a', { key: 'a', href: '#' }, 'docs'), ' first'])).toBe(true)
  })

  it('rejects multiple blocks, block elements, and content without text', () => {
    expect(isSingleLine([createElement('p', { key: 'a' }), createElement('p', { key: 'b' })])).toBe(false)
    expect(isSingleLine(createElement('ul', null, createElement('li', null, 'Item')))).toBe(false)
    expect(isSingleLine(createElement('a', { href: '#' }, 'Only a link'))).toBe(false)
    expect(isSingleLine(null)).toBe(false)
    expect(isSingleLine('   ')).toBe(false)
  })
})
