/** Unit coverage for scoping a registered built-in into a page-local inline component. */

import { describe, expect, it } from 'vitest'

import { injectScopedComponentReferences } from './scoped-component-references'

function program(body: string): string {
  return `import {jsx as _jsx, jsxs as _jsxs} from "react/jsx-runtime";\n${body}\n`
}

describe('injectScopedComponentReferences', () => {
  it('destructures an unresolved built-in from the runtime refs at call time', () => {
    const source = program(
      'export const DownloadPDFButton = () => {\n'
      + '  return _jsx(Icon, { icon: "download" });\n'
      + '};\n'
      + 'export default function MDXContent(props = {}) {\n'
      + '  return _jsx(DownloadPDFButton, {});\n'
      + '}\n',
    )
    const result = injectScopedComponentReferences(source)
    expect(result).toContain('let _mdxRuntimeRefs = {};')
    expect(result).toContain('_mdxRuntimeRefs = props.components || {};')
    expect(result).toMatch(/export const DownloadPDFButton = \(\) => \{\s*const \{ Icon \} = _mdxRuntimeRefs;/)
  })

  it('destructures every unresolved name once, sorted, for a single component', () => {
    const source = program(
      'export const Widget = () => {\n'
      + '  return _jsxs("div", { children: [_jsx(Tip, {}), _jsx(Note, {})] });\n'
      + '};\n'
      + 'export default function MDXContent(props = {}) { return _jsx(Widget, {}); }\n',
    )
    const result = injectScopedComponentReferences(source)
    expect(result).toContain('const { Note, Tip } = _mdxRuntimeRefs;')
  })

  it('leaves a locally declared or imported component alone', () => {
    const source = program(
      'import { Chart } from "./chart.js";\n'
      + 'export const Widget = () => {\n'
      + '  const Local = () => _jsx("span", {});\n'
      + '  return _jsxs("div", { children: [_jsx(Local, {}), _jsx(Chart, {})] });\n'
      + '};\n'
      + 'export default function MDXContent(props = {}) { return _jsx(Widget, {}); }\n',
    )
    expect(injectScopedComponentReferences(source)).toBe(source)
  })

  it('does not touch a page with no inline component at all', () => {
    const source = program('export default function MDXContent(props = {}) { return _jsx("p", {}); }\n')
    expect(injectScopedComponentReferences(source)).toBe(source)
  })

  it('wraps a concise-body arrow so the destructure can run before it', () => {
    const source = program(
      'export const Widget = () => _jsx(Icon, { icon: "download" });\n'
      + 'export default function MDXContent(props = {}) { return _jsx(Widget, {}); }\n',
    )
    const result = injectScopedComponentReferences(source)
    expect(result).toContain('const { Icon } = _mdxRuntimeRefs;')
    expect(result).toContain('return (_jsx(Icon, {')
  })

  it('does not resolve a component another inline component already provides', () => {
    const source = program(
      'export const Counter = () => _jsx("span", {});\n'
      + 'export const Widget = () => _jsx(Counter, {});\n'
      + 'export default function MDXContent(props = {}) { return _jsx(Widget, {}); }\n',
    )
    expect(injectScopedComponentReferences(source)).toBe(source)
  })
})
