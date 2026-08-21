/**
 * Accessible disclosure components for authored MDX.
 *
 * Accordions work independently or as joined items inside AccordionGroup. Item
 * ids are also URL targets: following a hash opens the matching disclosure.
 */
'use client'

import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { createContext, useContext, useEffect, useId, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Icon } from '@/components/mdx/content-icon'
import { cn } from '@/lib/utils'

interface AccordionGroupContextValue {
  isGrouped: true
}

const AccordionGroupContext = createContext<AccordionGroupContextValue | null>(null)

export interface AccordionProps {
  title: string
  description?: string
  id?: string
  icon?: string
  iconType?: 'solid' | 'outline'
  defaultOpen?: boolean
  children?: ReactNode
}

export interface AccordionGroupProps {
  children?: ReactNode
  type?: 'single' | 'multiple'
  defaultValue?: string | string[]
  className?: string
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function AccordionItem({ title, description, id, icon, iconType, children }: AccordionProps) {
  const generatedId = useId().replace(/:/g, '')
  const value = id || normalizeId(title) || generatedId

  useEffect(() => {
    if (window.location.hash.slice(1) !== value) return
    const trigger = document.getElementById(value)?.querySelector<HTMLButtonElement>('[data-accordion-trigger]')
    if (trigger?.dataset.state !== 'open') trigger?.click()
  }, [value])

  return (
    <AccordionPrimitive.Item
      id={value}
      value={value}
      className="group/accordion scroll-mt-24 border-b border-border/60 last:border-b-0"
    >
      <AccordionPrimitive.Header className="m-0">
        <AccordionPrimitive.Trigger
          data-accordion-trigger
          className="group flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <span className="flex min-w-0 gap-3">
            {icon ? (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40">
                <Icon icon={icon} iconType={iconType} className="h-4 w-4 text-foreground/65" />
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-base font-semibold leading-6 text-foreground">{title}</span>
              {description ? (
                <span className="mt-0.5 block text-sm font-normal leading-5 text-foreground/60">{description}</span>
              ) : null}
            </span>
          </span>
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-foreground/45 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="thally-accordion-content overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="prose prose-sm px-4 pb-5 pt-1 text-foreground/80 dark:prose-invert">{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  )
}

/** Render one disclosure, either independently or as part of AccordionGroup. */
export function Accordion(props: AccordionProps) {
  const group = useContext(AccordionGroupContext)
  const generatedId = useId().replace(/:/g, '')
  const value = props.id || normalizeId(props.title) || generatedId
  if (group) return <AccordionItem {...props} id={value} />

  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      defaultValue={props.defaultOpen ? value : undefined}
      className="not-prose my-4 overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <AccordionItem {...props} id={value} />
    </AccordionPrimitive.Root>
  )
}

/** Join related accordions into one accessible Radix keyboard-navigation group. */
export function AccordionGroup({ children, type = 'single', defaultValue, className }: AccordionGroupProps) {
  const rootClassName = cn('not-prose my-4 overflow-hidden rounded-xl border border-border/60 bg-card', className)
  const context = { isGrouped: true } as const

  if (type === 'multiple') {
    return (
      <AccordionGroupContext.Provider value={context}>
        <AccordionPrimitive.Root type="multiple" defaultValue={Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : undefined} className={rootClassName}>
          {children}
        </AccordionPrimitive.Root>
      </AccordionGroupContext.Provider>
    )
  }

  return (
    <AccordionGroupContext.Provider value={context}>
      <AccordionPrimitive.Root type="single" collapsible defaultValue={Array.isArray(defaultValue) ? defaultValue[0] : defaultValue} className={rootClassName}>
        {children}
      </AccordionPrimitive.Root>
    </AccordionGroupContext.Provider>
  )
}
