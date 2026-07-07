import type { MDXComponents } from 'mdx/types'
import { useMDXComponents as useCustomComponents } from '@/components/mdx/mdx-components'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return useCustomComponents(components)
}

