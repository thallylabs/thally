'use client'

/** Mintlify-compatible request/response examples plus legacy inline aliases. */

import { Children, isValidElement, type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

interface ExampleProps {
  children?: ReactNode
  dropdown?: boolean
}

function titledChildren(children: ReactNode) {
  return Children.toArray(children).filter((child) => {
    if (typeof child === 'string') return child.trim().length > 0
    return isValidElement(child)
  })
}

function exampleTitle(node: ReactNode, index: number): string {
  if (!isValidElement(node)) return `Example ${index + 1}`
  const props = node.props as { title?: unknown; label?: unknown; children?: ReactNode }
  if (typeof props.title === 'string') return props.title
  if (typeof props.label === 'string') return props.label
  const nested = Children.toArray(props.children).find(isValidElement)
  return nested ? exampleTitle(nested, index) : `Example ${index + 1}`
}

function SidebarExample({ children, dropdown = false, label }: ExampleProps & { label: string }) {
  const items = titledChildren(children)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = items[Math.min(selectedIndex, Math.max(0, items.length - 1))]

  return (
    <section className="not-prose my-4" data-example={label.toLowerCase()}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-foreground/55">{label}</span>
        {dropdown && items.length > 1 ? (
          <select
            aria-label={`${label} example`}
            value={selectedIndex}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            {items.map((item, index) => <option key={index} value={index}>{exampleTitle(item, index)}</option>)}
          </select>
        ) : null}
      </div>
      <div>
        {dropdown ? selected : children}
      </div>
    </section>
  )
}

/** Request code intended for a canonical Panel. */
export function RequestExample(props: ExampleProps) {
  return <SidebarExample {...props} label="Request" />
}

/** Response code intended for a canonical Panel. */
export function ResponseExample(props: ExampleProps) {
  return <SidebarExample {...props} label="Response" />
}

function InlineExample({ children, label, tone }: ExampleProps & { label: string; tone: string }) {
  return (
    <div className="not-prose my-6">
      <div className="flex items-center gap-2 rounded-t-2xl border border-b-0 border-border/40 bg-muted/60 px-4 py-2">
        <span className={cn('h-2 w-2 rounded-full', tone)} />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{label}</span>
      </div>
      <div className="[&>*]:!rounded-t-none [&>*]:!border-t-0">{children}</div>
    </div>
  )
}

export function InlineRequestExample(props: ExampleProps) {
  return <InlineExample {...props} label="Request" tone="bg-blue-400" />
}

export function InlineResponseExample(props: ExampleProps) {
  return <InlineExample {...props} label="Response" tone="bg-green-400" />
}
