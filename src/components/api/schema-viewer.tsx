interface SchemaViewerProps {
  title?: string
  schema?: Record<string, unknown>
}

export function SchemaViewer({ title, schema }: SchemaViewerProps) {
  if (!schema) {
    return null
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/40 p-4">
      {title ? <p className="text-xs font-semibold uppercase tracking-[0.3em] text-foreground/60">{title}</p> : null}
      <div className="space-y-3 text-sm text-foreground/80">
        <SchemaField schema={schema} />
      </div>
    </div>
  )
}

interface SchemaFieldProps {
  name?: string
  schema: Record<string, unknown>
  required?: boolean
  level?: number
}

function SchemaField({ name, schema, required = false, level = 0 }: SchemaFieldProps) {
  const type = getSchemaType(schema)
  const description = typeof schema.description === 'string' ? schema.description : undefined
  const isObject = type === 'object' && typeof schema.properties === 'object'
  const isArray = type === 'array' && schema.items && typeof schema.items === 'object'
  const enumValues = Array.isArray(schema.enum)
    ? (schema.enum.filter((value) => typeof value === 'string' || typeof value === 'number') as Array<string | number>)
    : []

  return (
    <div className="space-y-2">
      {name ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <code className="font-mono text-foreground">{name}</code>
          <span className="rounded-full border border-border/80 px-2 py-0.5 text-xs uppercase tracking-wide text-foreground/70">{type}</span>
          {required ? <span className="text-xs font-semibold uppercase text-rose-500">Required</span> : null}
        </div>
      ) : (
        <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs uppercase tracking-wide text-foreground/70">{type}</span>
      )}
      {description ? <p className="text-sm text-foreground/70">{description}</p> : null}
      {enumValues.length ? (
        <div className="text-xs text-foreground/60">
          Enum:{' '}
          <span className="font-mono">
            {enumValues.map((value, index) => (
              <span key={`${value}-${index}`}>
                {String(value)}
                {index < enumValues.length - 1 ? ', ' : ''}
              </span>
            ))}
          </span>
        </div>
      ) : null}
      {isObject ? (
        <div className="space-y-2 border-l border-border/60 pl-4">
          {Object.entries(schema.properties as Record<string, unknown>).map(([childName, childSchema]) => {
            if (!childSchema || typeof childSchema !== 'object') {
              return null
            }
            return (
              <SchemaField
                key={childName}
                name={childName}
                schema={childSchema as Record<string, unknown>}
                required={Array.isArray(schema.required) ? schema.required.includes(childName) : false}
                level={level + 1}
              />
            )
          })}
        </div>
      ) : null}
      {isArray ? (
        <div className="space-y-2 border-l border-dashed border-border/50 pl-4">
          <SchemaField schema={schema.items as Record<string, unknown>} level={level + 1} />
        </div>
      ) : null}
      {schema.$ref && typeof schema.$ref === 'string' ? (
        <p className="text-xs text-foreground/60">Reference: {schema.$ref}</p>
      ) : null}
    </div>
  )
}

function getSchemaType(schema: Record<string, unknown>) {
  if (typeof schema.$ref === 'string') {
    const parts = schema.$ref.split('/')
    return parts[parts.length - 1] ?? 'reference'
  }
  if (typeof schema.type === 'string') {
    return schema.type
  }
  if (Array.isArray(schema.type)) {
    return schema.type.join(' | ')
  }
  if (schema.properties) {
    return 'object'
  }
  if (schema.items) {
    return 'array'
  }
  return 'value'
}

