import type { MDXComponents } from 'mdx/types'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Note } from '@/components/mdx/note'
import { AgentPrompt } from '@/components/mdx/agent-prompt'
import { Code, CodeGroup, Pre } from '@/components/mdx/code-blocks'
import {
  Columns, Frame, Hero,
} from '@/components/mdx/rich-content'
import { Accordion, AccordionGroup } from '@/components/mdx/accordion'
import { Card, CardGroup, Tile, TileGroup } from '@/components/mdx/content-cards'
import { Icon } from '@/components/mdx/content-icon'
import { Badge, Tooltip } from '@/components/mdx/content-inline'
import { Color } from '@/components/mdx/color'
import { Update } from '@/components/mdx/content-metadata'
import { Panel, ContentPanel, InlinePanel } from '@/components/mdx/panel'
import {
  RequestExample,
  ResponseExample,
  InlineRequestExample,
  InlineResponseExample,
} from '@/components/mdx/examples'
import {
  Prompt,
  PromptAssistant,
  PromptUser,
  Terminal,
  TerminalInput,
  TerminalOutput,
} from '@/components/mdx/prompt'
import { Tree, Folder, File } from '@/components/mdx/file-tree'
import { ResponseField, ParamField, Expandable } from '@/components/mdx/api-fields'
import { Mermaid } from '@/components/mdx/mermaid'
import { Embed, LegacyView, View } from '@/components/mdx/view'
import { GitHub } from '@/components/mdx/github-card'
import { Agent, Human, Visibility } from '@/components/mdx/visibility'
import { BannerPreview } from '@/components/layout/site-banner'
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
  Check: (props) => <Note type="check" {...props} />,
  Danger: (props) => <Note type="danger" {...props} />,
  Error: (props) => <Note type="danger" {...props} />,
  Note: (props) => <Note type="note" {...props} />,
  Tip: (props) => <Note type="tip" {...props} />,
  // Callout: safety net for migrated content that uses <Callout type="...">
  Callout: ({ type, children }: { type?: string; children?: ReactNode }) => {
    if (!children) return null
    if (type === 'warning') return <Note type="warning">{children}</Note>
    if (type === 'danger' || type === 'error') return <Note type="danger">{children}</Note>
    if (type === 'info') return <Note type="info">{children}</Note>
    if (type === 'tip') return <Note type="tip">{children}</Note>
    if (type === 'check' || type === 'success') return <Note type="check">{children}</Note>
    if (type === 'note') return <Note type="note">{children}</Note>
    return <Note>{children}</Note>
  },
  AccordionGroup: (props) => <AccordionGroup {...props} />,
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
  ContentPanel: (props) => <ContentPanel {...props} />,
  InlinePanel: (props) => <InlinePanel {...props} />,
  InlineRequestExample: (props) => <InlineRequestExample {...props} />,
  InlineResponseExample: (props) => <InlineResponseExample {...props} />,
  Tile: (props) => <Tile {...props} />,
  TileGroup: (props) => <TileGroup {...props} />,
  Prompt: (props) => <Prompt {...props} />,
  PromptUser: (props) => <PromptUser {...props} />,
  PromptAssistant: (props) => <PromptAssistant {...props} />,
  Terminal: (props) => <Terminal {...props} />,
  TerminalInput: (props) => <TerminalInput {...props} />,
  TerminalOutput: (props) => <TerminalOutput {...props} />,
  AgentPrompt: (props) => <AgentPrompt {...props} />,
  // Preserve compound members used by generated MDX (`Color.Item` and
  // `Color.Row`). A wrapper component would discard those static properties.
  Color,
  'Color.Item': (props) => <Color.Item {...props} />,
  'Color.Row': (props) => <Color.Row {...props} />,
  Tree: (props) => <Tree {...props} />,
  Folder: (props) => <Folder {...props} />,
  File: (props) => <File {...props} />,
  ResponseField: (props) => <ResponseField {...props} />,
  ParamField: (props) => <ParamField {...props} />,
  Expandable: (props) => <Expandable {...props} />,
  Mermaid: (props) => <Mermaid {...(props as { children: string })} />,
  View: (props) => <View {...props} />,
  Embed: (props) => <Embed {...props} />,
  LegacyView: (props) => <LegacyView {...props} />,
  GitHub: (props) => <GitHub {...props} />,
  Github: (props) => <GitHub {...props} />,
  Visibility: (props) => <Visibility {...props} />,
  Human: (props) => <Human {...props} />,
  Agent: (props) => <Agent {...props} />,
  BannerPreview: (props) => <BannerPreview {...props} />,
  // Documentation screenshots are commonly below the fold. Native lazy
  // loading keeps them out of the critical request queue while preserving
  // standard Markdown image authoring and Frame zoom behavior.
  img: ({ alt = '', ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary MDX image sources cannot use a fixed Next loader.
    <img alt={alt} loading="lazy" decoding="async" {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="my-6 overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-border py-2 pr-4 text-left font-mono text-[0.68rem] font-medium uppercase tracking-[0.12em] text-foreground/55" {...props} />,
  td: (props) => <td className="border-b border-border py-3 pr-4 text-[0.88rem] leading-[1.6] text-foreground/80" {...props} />,
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
