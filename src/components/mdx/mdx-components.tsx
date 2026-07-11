import type { MDXComponents } from 'mdx/types'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Note } from '@/components/mdx/note'
import { Code, CodeGroup, Pre } from '@/components/mdx/code-blocks'
import {
  Badge, Card, CardGroup, Color, Columns, Frame, Hero, Icon, Panel,
  Prompt, PromptAssistant, PromptUser, RequestExample, ResponseExample,
  Tile, TileGroup, Tooltip, Update,
} from '@/components/mdx/rich-content'
import { Accordion } from '@/components/mdx/accordion'
import { Tree, Folder, File } from '@/components/mdx/file-tree'
import { ResponseField, ParamField, Expandable } from '@/components/mdx/api-fields'
import { Mermaid } from '@/components/mdx/mermaid'
import { View } from '@/components/mdx/view'
import { Steps, Step } from '@/components/mdx/steps'
import { Tabs, Tab } from '@/components/mdx/content-tabs'
import { HeadingAnchor } from '@/components/mdx/heading-anchor'
import { customComponents } from '@/mdx/custom-components'
import { cn, slugify } from '@/lib/utils'

function flattenText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (typeof node === 'object' && node && 'props' in node) {
    return flattenText((node as { props?: { children?: ReactNode } }).props?.children ?? '')
  }
  return ''
}

function createHeading(level: 2 | 3) {
  const Tag = `h${level}` as const
  return function Heading({ children }: { children: ReactNode }) {
    const text = flattenText(children)
    const id = slugify(text)
    return (
      // Size, weight, color, and rhythm come from the prose config in
      // tailwind.config.ts so MDX and plain-markdown headings share one scale.
      <Tag
        id={id}
        data-heading={text}
        data-level={level}
        className="scroll-mt-24"
      >
        <HeadingAnchor id={id}>
          {children}
        </HeadingAnchor>
      </Tag>
    )
  }
}

type CodeGroupProps = ComponentPropsWithoutRef<typeof CodeGroup>

const components: MDXComponents = {
  h2: createHeading(2),
  h3: createHeading(3),
  pre: (props) => <Pre {...(props as CodeGroupProps)} />,
  code: (props) => <Code {...props} />,
  CodeGroup: (props) => <CodeGroup {...(props as CodeGroupProps)} />,
  Info: (props) => <Note type="info" {...props} />,
  Warning: (props) => <Note type="warning" {...props} />,
  Error: (props) => <Note type="danger" {...props} />,
  Note: (props) => <Note type="note" {...props} />,
  Tip: (props) => <Note type="tip" {...props} />,
  // Callout: safety net for migrated content that uses <Callout type="...">
  Callout: ({ type, children }: { type?: string; children?: ReactNode }) => {
    if (!children) return null
    if (type === 'warning') return <Note type="warning">{children}</Note>
    if (type === 'danger' || type === 'error') return <Note type="danger">{children}</Note>
    if (type === 'info') return <Note type="info">{children}</Note>
    return <Note>{children}</Note>
  },
  // AccordionGroup: Mintlify wrapper — Thally uses <Accordion> directly, no group needed
  AccordionGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  // Latex: Mintlify LaTeX component — render as inline code (no renderer available)
  Latex: ({ children }: { children?: ReactNode }) => <code className="font-mono text-sm">{children}</code>,
  Hero: (props) => <Hero {...props} />,
  Card: (props) => <Card {...props} />,
  CardGroup: (props) => <CardGroup {...props} />,
  Columns: (props) => <Columns {...props} />,
  Frame: (props) => <Frame {...props} />,
  Accordion: (props) => <Accordion {...props} />,
  Tooltip: (props) => <Tooltip {...props} />,
  Icon: (props) => <Icon {...props} />,
  Steps: (props) => <Steps {...props} />,
  Step: (props) => <Step {...props} />,
  Tabs: (props) => <Tabs {...props} />,
  Tab: (props) => <Tab {...props} />,
  // Phase 1 additions
  Badge: (props) => <Badge {...props} />,
  Update: (props) => <Update {...props} />,
  RequestExample: (props) => <RequestExample {...props} />,
  ResponseExample: (props) => <ResponseExample {...props} />,
  Panel: (props) => <Panel {...props} />,
  Tile: (props) => <Tile {...props} />,
  TileGroup: (props) => <TileGroup {...props} />,
  Prompt: (props) => <Prompt {...props} />,
  PromptUser: (props) => <PromptUser {...props} />,
  PromptAssistant: (props) => <PromptAssistant {...props} />,
  Color: (props) => <Color {...props} />,
  Tree: (props) => <Tree {...props} />,
  Folder: (props) => <Folder {...props} />,
  File: (props) => <File {...props} />,
  ResponseField: (props) => <ResponseField {...props} />,
  ParamField: (props) => <ParamField {...props} />,
  Expandable: (props) => <Expandable {...props} />,
  Mermaid: (props) => <Mermaid {...(props as { children: string })} />,
  View: (props) => <View {...props} />,
  table: ({ className, ...props }) => (
    <div className="my-6 overflow-x-auto rounded-2xl border border-border">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-border/60 px-4 py-2 text-left text-xs uppercase tracking-wide text-foreground/70" {...props} />,
  td: (props) => <td className="border-b border-border/40 px-4 py-2 text-sm text-foreground/80" {...props} />,
}

export function useMDXComponents(existing: MDXComponents) {
  return {
    ...existing,
    ...components,
    // User-registered components (src/mdx/custom-components.tsx) merge last, so
    // they can add new components or override any built-in above.
    ...customComponents,
  }
}

