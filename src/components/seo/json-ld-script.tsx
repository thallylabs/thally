import { serializeJsonLd } from '@/lib/json-ld'

interface JsonLdScriptProps {
  data: Record<string, unknown>
}

export function JsonLdScript({ data }: JsonLdScriptProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
