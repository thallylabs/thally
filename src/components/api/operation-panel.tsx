'use client'

import { useState } from 'react'
import { ExamplePanel } from '@/components/api/example-panel'
import { TryItDialog } from '@/components/api/try-it-dialog'
import { OperationCodePanel } from '@/components/api/operation-code-panel'
import { useTryItController } from '@/components/api/use-try-it-controller'
import { ParamField, ResponseField, Expandable } from '@/components/mdx/api-fields'
import type { NormalizedOperation, NormalizedParameter, NormalizedResponse } from '@/lib/openapi/types'
import { EndpointBar } from '@/components/api/endpoint-bar'
import { statusColorClass, statusUnderlineClass } from '@/components/api/tokens'
import { authDescription } from '@/lib/openapi/auth'
import { cn } from '@/lib/utils'
import Markdown from '@/components/mdx/markdown'
import { Prose } from '@/components/mdx/prose'

interface OperationPanelProps {
  operation: NormalizedOperation
  /** The page's own MDX body, shown between the header and the schema. */
  children?: React.ReactNode
  /** False when the page header already shows the page's authored description. */
  showDescription?: boolean
}

export function OperationPanel({ operation, children, showDescription = true }: OperationPanelProps) {
  const controller = useTryItController(operation)
  const [isDialogOpen, setDialogOpen] = useState(false)

  type ParamLocation = 'path' | 'query' | 'header' | 'cookie'
  const parameterGroups: Array<{ title: string; location: ParamLocation; parameters: Array<NormalizedParameter> }> = [
    { title: 'Path parameters', location: 'path' as const, parameters: operation.parameters.path },
    { title: 'Query parameters', location: 'query' as const, parameters: operation.parameters.query },
    { title: 'Headers', location: 'header' as const, parameters: operation.parameters.header },
    { title: 'Cookie parameters', location: 'cookie' as const, parameters: operation.parameters.cookie },
  ].filter((group) => group.parameters.length > 0)

  return (
    <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-10">
        {/* Header */}
        <header className="space-y-6">
          <EndpointBar operation={operation} onTryIt={() => setDialogOpen(true)} />
          {!showDescription ? null : operation.description ? (
            <div className="prose prose-neutral dark:prose-invert max-w-none text-base text-foreground/70">
              <Markdown>{operation.description}</Markdown>
            </div>
          ) : (
            <p className="text-base text-foreground/70">
              This endpoint handles {operation.method} requests for <code className="font-mono text-sm">{operation.path}</code>.
              Review the request parameters and response schema below.
            </p>
          )}
        </header>

        {children ? <Prose>{children}</Prose> : null}

        {/* Servers */}
        {operation.servers.length > 1 ? (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">Servers</p>
            <div className="border-y border-border">
              {operation.servers.map((server) => (
                <div key={server.url} className="flex flex-wrap items-baseline gap-x-4 border-b border-border px-0 py-3 last:border-b-0">
                  <p className="text-sm font-semibold text-foreground break-all">{server.url}</p>
                  {server.description ? <p className="text-xs text-foreground/60">{server.description}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Authorizations */}
        {operation.authSchemes.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Authorizations</h2>
            <div className="border-y border-border">
              {operation.authSchemes.map((scheme) => (
                <ParamField
                  key={scheme.name}
                  name={scheme.paramName}
                  type="string"
                  required
                  header={scheme.in === 'header'}
                  query={scheme.in === 'query'}
                >
                  <Markdown>{authDescription(scheme)}</Markdown>
                </ParamField>
              ))}
            </div>
          </section>
        ) : null}

        {/* Parameters */}
        {parameterGroups.length ? (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Parameters</h2>
            {parameterGroups.map((group) => (
              <div key={group.title}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">{group.title}</p>
                <div className="border-y border-border">
                  {group.parameters.map((param) => (
                    <ParamField
                      key={param.name}
                      name={param.name}
                      type={resolveSchemaType(param.schema)}
                      required={param.required}
                      query={group.location === 'query'}
                      path={group.location === 'path'}
                      header={group.location === 'header'}
                      default={resolveDefault(param.schema)}
                    >
                      {param.description ? <Markdown>{param.description}</Markdown> : null}
                    </ParamField>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* Request body */}
        {operation.requestBody ? (
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">Request body</h2>
              {operation.requestBody.description ? <Markdown className="text-sm text-foreground/70">{operation.requestBody.description}</Markdown> : null}
            </div>
            {operation.requestBody.contents.map((content) => (
              <div key={content.mediaType}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded border border-border/40 bg-muted px-2 py-0.5 font-mono text-xs text-foreground/70">{content.mediaType}</span>
                  <span className="text-xs text-foreground/50">{operation.requestBody?.required ? 'Required' : 'Optional'}</span>
                </div>
                <div className="border-y border-border">
                  <SchemaAsParamFields schema={content.schema} />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {/* Responses */}
        {operation.responses.length ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Responses</h2>
            <ResponseTabs responses={operation.responses} />
          </section>
        ) : null}
      </div>

      {operation.isWebhook ? (
        <WebhookExample body={operation.prefill.body} />
      ) : (
        <>
          <OperationCodePanel controller={controller} />
          <TryItDialog controller={controller} open={isDialogOpen} onOpenChange={setDialogOpen} />
        </>
      )}
    </div>
  )
}

/** Webhooks are received, not called: show the payload we send instead of a request sample. */
function WebhookExample({ body }: { body?: string }) {
  if (!body) return <div />
  return (
    <div className="overflow-hidden rounded-[11px] border border-border bg-muted/40">
      <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">Example</div>
      <pre className="scrollbar-hide max-h-[480px] overflow-auto bg-transparent p-4 font-mono text-[0.82rem] leading-[1.65] text-foreground/80">{body}</pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SchemaAsParamFields — renders object properties as ParamField rows
// ---------------------------------------------------------------------------

function SchemaAsParamFields({ schema }: { schema?: Record<string, unknown> }) {
  if (!schema) return null

  const flat = flattenSchema(schema)
  const properties = flat.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties || typeof properties !== 'object') {
    const variants = unionVariants(flat)
    if (variants) return <SchemaVariants variants={variants} depth={0} />
    return (
      <ParamField name="(body)" type={resolveSchemaType(flat)}>
        {typeof flat.description === 'string' ? <Markdown>{flat.description}</Markdown> : null}
      </ParamField>
    )
  }

  const required = Array.isArray(flat.required) ? (flat.required as string[]) : []

  return (
    <>
      {Object.entries(properties).map(([name, propSchema]) => {
        const flatProp = flattenSchema(propSchema)
        const type = resolveSchemaType(flatProp)
        const description = typeof flatProp.description === 'string' ? flatProp.description : undefined
        const defaultVal = resolveDefault(flatProp)
        const isRequired = required.includes(name)
        const nested = getNestedProperties(flatProp)
        const enumValues = Array.isArray(flatProp.enum) ? (flatProp.enum as unknown[]).map(String) : null

        return (
          <ParamField
            key={name}
            name={name}
            type={type}
            required={isRequired}
            deprecated={flatProp.deprecated === true}
            default={defaultVal}
            body
          >
            {description ? <Markdown>{description}</Markdown> : null}
            {enumValues ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed: {enumValues.join(', ')}
              </p>
            ) : null}
            {flatProp.const !== undefined ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed value: <code>{JSON.stringify(flatProp.const)}</code>
              </p>
            ) : null}
            {nested ? (
              <Expandable title={`${name} properties`}>
                <NestedFields schema={flatProp} depth={1} />
              </Expandable>
            ) : null}
          </ParamField>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// ResponseTabs — status-code tab bar, one tab per response
// ---------------------------------------------------------------------------

function ResponseTabs({ responses }: { responses: Array<NormalizedResponse> }) {
  const [activeCode, setActiveCode] = useState(responses[0]?.code ?? '')
  const active = responses.find((r) => r.code === activeCode) ?? responses[0]

  return (
    <div className="overflow-hidden border-y border-border">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border px-3 pt-1">
        {responses.map((response) => {
          const isActive = response.code === activeCode
          const colorClass = statusColorClass(response.code)
          return (
            <button
              key={response.code}
              type="button"
              onClick={() => setActiveCode(response.code)}
              className={cn(
                'relative px-3 py-2 text-xs font-semibold transition',
                isActive ? colorClass : 'text-foreground/40 hover:text-foreground/70',
              )}
            >
              {response.code}
              {isActive ? <span className={cn('absolute inset-x-0 -bottom-px h-0.5 rounded-full', statusUnderlineClass(response.code))} /> : null}
            </button>
          )
        })}
      </div>

      {/* Active response content */}
      {active ? (
        <div className="px-4 py-3">
          {active.description ? (
            <Markdown className="mb-3 text-sm text-foreground/60">{active.description}</Markdown>
          ) : null}
          {active.contents.length ? (
            active.contents.map((content) => (
              <div key={content.mediaType}>
                <SchemaAsResponseFields schema={content.schema} />
                <ExamplePanel title="Example" mediaType={content.mediaType} example={content.example} examples={content.examples} />
              </div>
            ))
          ) : (
            <p className="text-sm text-foreground/50">No response body.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SchemaAsResponseFields — renders object properties as ResponseField rows
// ---------------------------------------------------------------------------

function SchemaAsResponseFields({ schema, depth = 0 }: { schema?: Record<string, unknown>; depth?: number }) {
  if (!schema) return null

  const flat = flattenSchema(schema)
  const properties = flat.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties || typeof properties !== 'object') {
    const variants = unionVariants(flat)
    return variants ? <SchemaVariants variants={variants} depth={depth} /> : null
  }

  const required = Array.isArray(flat.required) ? (flat.required as string[]) : []

  return (
    <>
      {Object.entries(properties).map(([name, propSchema]) => {
        const flatProp = flattenSchema(propSchema)
        const type = resolveSchemaType(flatProp)
        const description = typeof flatProp.description === 'string' ? flatProp.description : undefined
        const isRequired = required.includes(name)
        const nested = depth < MAX_NESTING && getNestedProperties(flatProp)
        const enumValues = Array.isArray(flatProp.enum) ? (flatProp.enum as unknown[]).map(String) : null

        return (
          <ResponseField key={name} name={name} type={type} required={isRequired} deprecated={flatProp.deprecated === true}>
            {description ? <Markdown>{description}</Markdown> : null}
            {enumValues ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed: {enumValues.join(', ')}
              </p>
            ) : null}
            {flatProp.const !== undefined ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed value: <code>{JSON.stringify(flatProp.const)}</code>
              </p>
            ) : null}
            {nested ? (
              <Expandable title={`${name} properties`}>
                <NestedFields schema={flatProp} depth={depth + 1} />
              </Expandable>
            ) : null}
          </ResponseField>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// oneOf / anyOf — a tab per variant, each with its own fields
// ---------------------------------------------------------------------------

/** Nested levels expanded before a schema is cut off, so a deeply recursive one stays finite. */
const MAX_NESTING = 6

interface SchemaVariant {
  /** The variant's own title, or its discriminator value. */
  label?: string
  schema: Record<string, unknown>
}

function unionVariants(schema: Record<string, unknown>): Array<SchemaVariant> | null {
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  const entries = list?.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
  if (!entries?.length) return null
  const discriminator = (schema.discriminator as { propertyName?: unknown } | undefined)?.propertyName
  return entries.flatMap((entry) => {
    const flat = flattenSchema(entry)
    // A variant that is only a union itself is spread into this one, as live does.
    const inner = flat.properties ? null : unionVariants(flat)
    if (inner) return inner
    const property = typeof discriminator === 'string' ? (flat.properties as Record<string, Record<string, unknown>> | undefined)?.[discriminator] : undefined
    const value = property?.const ?? (Array.isArray(property?.enum) ? property.enum[0] : undefined)
    return [{
      label: typeof flat.title === 'string' ? flat.title : value !== undefined ? String(value) : undefined,
      schema: flat,
    }]
  })
}

function unionType(variants: Array<SchemaVariant>): string {
  return variants
    .map((variant) => {
      const type = resolveSchemaType(variant.schema) ?? 'any'
      return variant.label ? `${variant.label} · ${type}` : type
    })
    .join(' | ')
}

function NestedFields({ schema, depth }: { schema: Record<string, unknown>; depth: number }) {
  const nested = getNestedSchema(schema)
  const variants = unionVariants(nested)
  return variants ? <SchemaVariants variants={variants} depth={depth} /> : <SchemaAsResponseFields schema={nested} depth={depth} />
}

function SchemaVariants({ variants, depth }: { variants: Array<SchemaVariant>; depth: number }) {
  const [active, setActive] = useState(0)
  const current = variants[active] ?? variants[0]
  const description = typeof current.schema.description === 'string' ? current.schema.description : undefined
  const hasFields = getNestedProperties(current.schema)

  return (
    <div>
      {variants.length > 1 ? (
        <div role="tablist" aria-label="Variants" className="mb-3 flex flex-wrap gap-1.5">
          {variants.map((variant, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs font-medium transition',
                index === active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-foreground/60 hover:text-foreground',
              )}
            >
              {variant.label ?? `Option ${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      {description ? <Markdown className="mb-2 text-sm text-foreground/70">{description}</Markdown> : null}
      {hasFields ? (
        <SchemaAsResponseFields schema={current.schema} depth={depth} />
      ) : (
        <p className="text-xs text-foreground/60">
          Type: <code>{resolveSchemaType(current.schema) ?? 'any'}</code>
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/**
 * Merges allOf fragments into a single flat schema so the renderer can
 * iterate over a unified properties map instead of checking each fragment.
 */
function flattenSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.allOf)) return schema

  const merged: Record<string, unknown> = { ...schema }
  const allOf = schema.allOf as Array<unknown>
  delete (merged as Record<string, unknown>).allOf

  const mergedProps: Record<string, unknown> = {}
  const mergedRequired: string[] = []

  for (const fragment of allOf) {
    if (!fragment || typeof fragment !== 'object') continue
    const f = flattenSchema(fragment as Record<string, unknown>)
    if (f.properties && typeof f.properties === 'object') {
      Object.assign(mergedProps, f.properties as Record<string, unknown>)
    }
    if (Array.isArray(f.required)) {
      mergedRequired.push(...(f.required as string[]))
    }
    if (!merged.type && f.type) merged.type = f.type
  }

  if (Object.keys(mergedProps).length > 0) {
    merged.properties = { ...((merged.properties as Record<string, unknown>) ?? {}), ...mergedProps }
  }
  if (mergedRequired.length > 0) {
    const existing = Array.isArray(merged.required) ? (merged.required as string[]) : []
    merged.required = [...new Set([...existing, ...mergedRequired])]
  }
  return merged
}

function resolveSchemaType(schema?: Record<string, unknown>): string | undefined {
  if (!schema) return undefined
  if (typeof schema.$ref === 'string') {
    const parts = schema.$ref.split('/')
    return parts[parts.length - 1]
  }
  const variants = schema.type === undefined ? unionVariants(schema) : null
  if (variants) return unionType(variants)
  if (Array.isArray(schema.type)) {
    return (schema.type as string[]).join(' | ')
  }
  if (typeof schema.type === 'string') {
    if (schema.type === 'array' && schema.items && typeof schema.items === 'object') {
      const items = flattenSchema(schema.items as Record<string, unknown>)
      const itemType = resolveSchemaType(items)
      const several = (unionVariants(items)?.length ?? 0) > 1
      return itemType ? `${several ? `(${itemType})` : itemType}[]` : 'array'
    }
    if (Array.isArray(schema.enum)) return `enum<${schema.type}>`
    if (schema.type === 'string' && typeof schema.format === 'string') return `string<${schema.format}>`
    return schema.type
  }
  if (Array.isArray(schema.allOf)) return 'object'
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  return undefined
}

function resolveDefault(schema?: Record<string, unknown>): string | undefined {
  if (!schema || schema.default === undefined) return undefined
  return typeof schema.default === 'object' ? JSON.stringify(schema.default) : String(schema.default)
}

function getNestedProperties(schema: Record<string, unknown>): boolean {
  const flat = flattenSchema(schema)
  if (flat.properties) return true
  const variants = unionVariants(flat)
  if (variants) return variants.some((variant) => getNestedProperties(variant.schema))
  return flat.type === 'array' && Boolean(flat.items) && typeof flat.items === 'object' && getNestedProperties(flat.items as Record<string, unknown>)
}

function getNestedSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const flat = flattenSchema(schema)
  if (flat.type === 'array' && flat.items && typeof flat.items === 'object') {
    return getNestedSchema(flat.items as Record<string, unknown>)
  }
  return flat
}
