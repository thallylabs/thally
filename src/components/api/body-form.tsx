'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Markdown } from '@/components/mdx/markdown'
import { activeVariant, emptyValue, schemaKind, withField } from '@/lib/openapi/body-form'
import { flattenSchema, unionVariants } from '@/lib/openapi/schema-variants'

type Schema = Record<string, unknown>
type Change = (next: unknown) => void

interface FormProps {
  /** Files chosen for `format: binary` fields, by field name; the JSON value holds only the file name. */
  onFile: (name: string, file: File | null) => void
}

const inputClass = 'w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm'

/** A typed form for a request schema. The value is plain JSON, so it stays in step with the raw JSON editor. */
export function BodyForm({ schema, value, onChange, onFile }: FormProps & { schema: Schema; value: unknown; onChange: Change }) {
  return <Control schema={schema} value={value} onChange={onChange} name="body" depth={0} top onFile={onFile} />
}

function Control({ schema, value, onChange, name, depth, required, top, onFile }: FormProps & { schema: Schema; value: unknown; onChange: Change; name: string; depth: number; required?: boolean; top?: boolean }) {
  const flat = flattenSchema(schema)
  const variants = flat.type === undefined ? unionVariants(flat) : null
  if (variants) {
    const index = activeVariant(variants, value)
    return (
      <div className="space-y-2">
        {variants.length > 1 ? (
          <select
            aria-label={`${name} variant`}
            value={index}
            onChange={(event) => onChange(emptyValue(variants[Number(event.target.value)].schema))}
            className={inputClass}
          >
            {variants.map((variant, i) => (
              <option key={i} value={i}>{variant.label ?? `Option ${i + 1}`}</option>
            ))}
          </select>
        ) : null}
        <Control schema={variants[index].schema} value={value} onChange={onChange} name={name} depth={depth} required={required} top={top} onFile={onFile} />
      </div>
    )
  }
  const kind = schemaKind(flat)
  const placeholder = [flat.default, flat.example].find((entry) => entry !== undefined && typeof entry !== 'object')

  if (kind === 'object' && flat.properties) {
    return <ObjectFields schema={flat} value={value} onChange={onChange} depth={depth} top={top} onFile={onFile} />
  }
  if (kind === 'object' || (kind === 'array' && !flat.items)) return <JsonControl name={name} value={value} onChange={onChange} />
  if (kind === 'array') {
    const items = Array.isArray(value) ? value : []
    const itemSchema = flat.items as Schema
    return (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Control schema={itemSchema} value={item} onChange={(next) => onChange(items.map((old, j) => (j === i ? next : old)))} name={`${name} ${i + 1}`} depth={depth + 1} required onFile={onFile} />
            </div>
            <button type="button" aria-label={`Remove ${name} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded-[9px] border border-border p-2 text-foreground/60 hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, emptyValue(itemSchema) ?? 0])} className="flex items-center gap-1 text-xs text-foreground/70 hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Add an item
        </button>
      </div>
    )
  }
  if (Array.isArray(flat.enum)) {
    const options = flat.enum as Array<unknown>
    return (
      <select
        aria-label={name}
        value={value === undefined ? '' : String(value)}
        onChange={(event) => onChange(options.find((option) => String(option) === event.target.value))}
        className={inputClass}
      >
        {required && value !== undefined ? null : <option value="" />}
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>{String(option)}</option>
        ))}
      </select>
    )
  }
  if (kind === 'boolean') {
    return (
      <select aria-label={name} value={value === undefined ? '' : String(value)} onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value === 'true')} className={inputClass}>
        {required && value !== undefined ? null : <option value="" />}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  if (kind === 'integer' || kind === 'number') {
    return (
      <input
        type="number"
        aria-label={name}
        step={kind === 'integer' ? 1 : 'any'}
        value={typeof value === 'number' && !Number.isNaN(value) ? value : ''}
        placeholder={placeholder === undefined ? undefined : String(placeholder)}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        className={inputClass}
      />
    )
  }
  if (flat.format === 'binary') {
    return (
      <input
        type="file"
        aria-label={name}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null
          onFile(name, file)
          onChange(file ? file.name : undefined)
        }}
        className="w-full text-sm"
      />
    )
  }
  return (
    <input
      aria-label={name}
      value={typeof value === 'string' ? value : value === undefined ? '' : String(value)}
      placeholder={placeholder === undefined ? undefined : String(placeholder)}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
    />
  )
}

/** Free-form values (an object with no declared properties) are edited as JSON. */
function JsonControl({ name, value, onChange }: { name: string; value: unknown; onChange: Change }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value)))
  const [invalid, setInvalid] = useState(false)
  return (
    <>
      <input
        aria-label={`${name} (JSON)`}
        aria-invalid={invalid}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          try {
            onChange(event.target.value.trim() ? JSON.parse(event.target.value) : undefined)
            setInvalid(false)
          } catch {
            setInvalid(true)
          }
        }}
        className={`${inputClass} font-mono`}
      />
      {invalid ? <p role="alert" className="mt-1 text-xs text-rose-500">Not valid JSON</p> : null}
    </>
  )
}

function ObjectFields({ schema, value, onChange, depth, top, onFile }: FormProps & { schema: Schema; value: unknown; onChange: Change; depth: number; top?: boolean }) {
  const properties = Object.entries(schema.properties as Record<string, Schema>)
  const required = new Set(Array.isArray(schema.required) ? (schema.required as Array<string>) : [])
  const current = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const row = ([key, property]: [string, Schema]) => {
    const flat = flattenSchema(property)
    const nested = schemaKind(flat) === 'object' && Boolean(flat.properties)
    const description = typeof flat.description === 'string' ? flat.description : undefined
    const label = (
      <>
        <span className="font-mono text-xs font-semibold text-foreground">{key}</span>
        <span className="ml-2 text-[11px] text-foreground/50">{typeof flat.type === 'string' ? flat.type : ''}</span>
        {required.has(key) ? <span className="ml-2 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-400">required</span> : null}
      </>
    )
    const control = (
      <Control schema={flat} value={current[key]} onChange={(next) => onChange(withField(current, key, next, required.has(key)))} name={key} depth={depth + 1} required={required.has(key)} onFile={onFile} />
    )
    return nested ? (
      <details key={key} open={required.has(key)} className="rounded-[9px] border border-border p-3">
        <summary className="cursor-pointer">{label}</summary>
        <div className="mt-3">{control}</div>
      </details>
    ) : (
      <div key={key} className="space-y-1">
        <div>{label}</div>
        {description ? <Markdown className="text-xs text-foreground/60">{description}</Markdown> : null}
        {control}
      </div>
    )
  }
  const requiredRows = properties.filter(([key]) => required.has(key))
  const optionalRows = properties.filter(([key]) => !required.has(key))
  return (
    <div className="space-y-4">
      {requiredRows.map(row)}
      {optionalRows.length ? (
        <details open={!top} className="space-y-4">
          <summary className="cursor-pointer text-xs text-foreground/70">Show {optionalRows.length} optional fields</summary>
          <div className="mt-4 space-y-4">{optionalRows.map(row)}</div>
        </details>
      ) : null}
    </div>
  )
}
