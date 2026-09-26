import type { MDXComponents } from 'mdx/types'
import { builtinMdxComponents } from '@/components/mdx/builtin-components'
import { customComponents } from '@/mdx/custom-components'

export function useMDXComponents(existing: MDXComponents) {
  return {
    ...existing,
    ...builtinMdxComponents,
    // User-registered components (src/mdx/custom-components.tsx) merge last, so
    // they can add new components or override any built-in above.
    ...customComponents,
  }
}
