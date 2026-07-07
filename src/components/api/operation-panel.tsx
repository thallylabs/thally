'use client'

import { useState } from 'react'
import { ExamplePanel } from '@/components/api/example-panel'
import { TryItDialog } from '@/components/api/try-it-dialog'
import { OperationCodePanel } from '@/components/api/operation-code-panel'
import { useTryItController } from '@/components/api/use-try-it-controller'
import { ParamField, ResponseField, Expandable } from '@/components/mdx/api-fields'
import type { NormalizedOperation, NormalizedParameter, NormalizedResponse } from '@/lib/openapi/types'
import { getMethodToken } from '@/components/api/tokens'
import { cn } from '@/lib/utils'
import Markdown from '@/components/mdx/markdown'

interface OperationPanelProps {
  operation: NormalizedOperation
}

export function OperationPanel({ operation }: OperationPanelProps) {
  const controller = useTryItController(operation)
  const methodToken = getMethodToken(operation.method)
  const [isDialogOpen, setDialogOpen] = useState(false)

  type ParamLocation = 'path' | 'query' | 'header' | 'cookie'
  const parameterGroups: Array<{ title: string; location: ParamLocation; parameters: Array<NormalizedParameter> }> = [
    { title: 'Path parameters', location: 'path' as const, parameters: operation.parameters.path },
    { title: 'Query parameters', location: 'query' as const, parameters: operation.parameters.query },
    { title: 'Headers', location: 'header' as const, parameters: operation.parameters.header },
    { title: 'Cookie parameters', location: 'cookie' as const, parameters: operation.parameters.cookie },
  ].filter((group) => group.parameters.length > 0)

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-10">
        {/* Header */}
        <header className="space-y-6 rounded-3xl border border-border/20 bg-gradient-to-br from-background via-background to-muted/20 p-6 shadow-sm">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">{operation.group}</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">{operation.title}</h1>
              {operation.description ? (
                <div className="prose prose-neutral dark:prose-invert max-w-none text-base text-foreground/70">
                  <Markdown>{operation.description}</Markdown>
                </div>
              ) : (
                <p className="text-base text-foreground/70">
                  This endpoint handles {operation.method} requests for <code className="font-mono text-sm">{operation.path}</code>.
                  Review the request parameters and response schema below.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border/30 bg-background/60 px-4 py-3">
            <span className={cn('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest', methodToken.bg, methodToken.text)}>{operation.method}</span>
            <code className="flex-1 text-sm font-semibold text-foreground break-all">
              {(operation.servers[0]?.url?.replace(/\/$/, '') ?? '')}
              {operation.path}
            </code>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-foreground shadow hover:bg-accent/90"
            >
              Try it
            </button>
          </div>
        </header>

        {/* Servers */}
        {operation.servers.length ? (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">Servers</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {operation.servers.map((server) => (
                <div key={server.url} className="rounded-xl border border-border/30 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground break-all">{server.url}</p>
                  {server.description ? <p className="text-xs text-foreground/60">{server.description}</p> : null}
                </div>
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
                <div className="rounded-2xl border border-border/40 px-4">
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
                      {param.description ?? null}
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
              {operation.requestBody.description ? <p className="text-sm text-foreground/70">{operation.requestBody.description}</p> : null}
            </div>
            {operation.requestBody.contents.map((content) => (
              <div key={content.mediaType}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded border border-border/40 bg-muted px-2 py-0.5 font-mono text-xs text-foreground/70">{content.mediaType}</span>
                  <span className="text-xs text-foreground/50">{operation.requestBody?.required ? 'Required' : 'Optional'}</span>
                </div>
                <div className="rounded-2xl border border-border/40 px-4">
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

        {/* Security */}
        {operation.security.length ? (
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50">Security</p>
            <div className="space-y-3">
              {operation.security.map((group, index) => (
                <div key={`${group.map((item) => item.name).join('-')}-${index}`} className="rounded-2xl border border-border/40 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">One of the following</p>
                  <div className="mt-2 space-y-2">
                    {group.map((requirement) => (
                      <div key={requirement.name} className="rounded-xl border border-border/40 p-3">
                        <p className="text-sm font-semibold text-foreground">{requirement.name}</p>
                        {requirement.scopes.length ? (
                          <p className="text-xs text-foreground/60">Scopes: {requirement.scopes.join(', ')}</p>
                        ) : (
                          <p className="text-xs text-foreground/60">No scopes required</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <OperationCodePanel controller={controller} />
      <TryItDialog controller={controller} open={isDialogOpen} onOpenChange={setDialogOpen} />
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
    return (
      <ParamField name="(body)" type={resolveSchemaType(flat)}>
        {typeof flat.description === 'string' ? flat.description : null}
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
            default={defaultVal}
            body
          >
            {description ?? null}
            {enumValues ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed: {enumValues.join(', ')}
              </p>
            ) : null}
            {nested ? (
              <Expandable title={`${name} properties`}>
                <SchemaAsResponseFields schema={flatProp} />
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
    <div className="overflow-hidden rounded-2xl border border-border/40">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border/30 bg-muted/30 px-3 pt-1">
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
            <p className="mb-3 text-sm text-foreground/60">{active.description}</p>
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

function statusColorClass(code: string) {
  if (code.startsWith('2')) return 'text-green-600 dark:text-green-400'
  if (code.startsWith('3')) return 'text-sky-600 dark:text-sky-400'
  if (code.startsWith('4')) return 'text-amber-600 dark:text-amber-400'
  if (code.startsWith('5')) return 'text-rose-600 dark:text-rose-400'
  return 'text-foreground'
}

function statusUnderlineClass(code: string) {
  if (code.startsWith('2')) return 'bg-green-500'
  if (code.startsWith('3')) return 'bg-sky-500'
  if (code.startsWith('4')) return 'bg-amber-500'
  if (code.startsWith('5')) return 'bg-rose-500'
  return 'bg-accent'
}

// ---------------------------------------------------------------------------
// SchemaAsResponseFields — renders object properties as ResponseField rows
// ---------------------------------------------------------------------------

function SchemaAsResponseFields({ schema }: { schema?: Record<string, unknown> }) {
  if (!schema) return null

  const flat = flattenSchema(schema)
  const properties = flat.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties || typeof properties !== 'object') return null

  const required = Array.isArray(flat.required) ? (flat.required as string[]) : []

  return (
    <>
      {Object.entries(properties).map(([name, propSchema]) => {
        const flatProp = flattenSchema(propSchema)
        const type = resolveSchemaType(flatProp)
        const description = typeof flatProp.description === 'string' ? flatProp.description : undefined
        const isRequired = required.includes(name)
        const nested = getNestedProperties(flatProp)
        const enumValues = Array.isArray(flatProp.enum) ? (flatProp.enum as unknown[]).map(String) : null

        return (
          <ResponseField key={name} name={name} type={type} required={isRequired}>
            {description ?? null}
            {enumValues ? (
              <p className="mt-1 text-xs text-foreground/50">
                Allowed: {enumValues.join(', ')}
              </p>
            ) : null}
            {nested ? (
              <Expandable title={`${name} properties`}>
                <SchemaAsResponseFields schema={getNestedSchema(flatProp)} />
              </Expandable>
            ) : null}
          </ResponseField>
        )
      })}
    </>
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
  if (Array.isArray(schema.type)) {
    return (schema.type as string[]).join(' | ')
  }
  if (typeof schema.type === 'string') {
    if (schema.type === 'array' && schema.items && typeof schema.items === 'object') {
      const items = flattenSchema(schema.items as Record<string, unknown>)
      const itemType = resolveSchemaType(items)
      return itemType ? `${itemType}[]` : 'array'
    }
    return schema.type
  }
  if (Array.isArray(schema.allOf)) return 'object'
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return 'oneOf'
  if (schema.properties) return 'object'
  if (schema.items) return 'array'
  return undefined
}

function resolveDefault(schema?: Record<string, unknown>): string | undefined {
  if (!schema || schema.default === undefined) return undefined
  return String(schema.default)
}

function getNestedProperties(schema: Record<string, unknown>): boolean {
  const flat = flattenSchema(schema)
  if ((flat.type === 'object' || flat.properties) && flat.properties) return true
  if (flat.type === 'array' && flat.items && typeof flat.items === 'object') {
    const items = flattenSchema(flat.items as Record<string, unknown>)
    return !!(items.properties || Array.isArray(items.allOf))
  }
  return false
}

function getNestedSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const flat = flattenSchema(schema)
  if (flat.type === 'array' && flat.items && typeof flat.items === 'object') {
    return flattenSchema(flat.items as Record<string, unknown>)
  }
  return flat
}
