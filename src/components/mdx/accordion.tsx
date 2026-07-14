'use client'

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

interface AccordionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

export function Accordion({ title, defaultOpen = false, children }: AccordionProps) {
  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'item' : undefined}
      className="not-prose my-4"
    >
      <AccordionPrimitive.Item
        value="item"
        className="overflow-hidden rounded-2xl border border-border/60 bg-card"
      >
        <AccordionPrimitive.Header className="m-0">
          <AccordionPrimitive.Trigger className="group flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-base font-semibold text-foreground transition hover:bg-muted/40">
            {title}
            <ChevronDown
              className="h-4 w-4 shrink-0 text-foreground/50 transition-transform duration-200 group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content className="thally-accordion-content overflow-hidden">
          <div className="prose prose-sm px-4 pb-4 pt-1 text-foreground/80 dark:prose-invert">
            {children}
          </div>
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  )
}
