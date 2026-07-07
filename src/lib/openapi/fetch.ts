import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { ApiReferenceConfig, ApiSpecConfig, OpenAPIDocument, ResolvedSpec } from '@/lib/openapi/types'

const specCache = new Map<string, Promise<OpenAPIDocument>>()

function cacheKey(config: ApiSpecConfig) {
  return config.id
}

async function readFromFile(filePath: string) {
  // URL-style paths like /openapi.json are served from public/ at runtime,
  // so resolve them relative to public/ on the filesystem.
  const absolutePath = filePath.startsWith('/')
    ? path.resolve(process.cwd(), 'public', filePath.slice(1))
    : path.resolve(process.cwd(), filePath)
  const buffer = await readFile(absolutePath, 'utf8')
  const ext = path.extname(absolutePath).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') {
    return parseYaml(buffer) as OpenAPIDocument
  }
  return JSON.parse(buffer) as OpenAPIDocument
}

async function readFromUrl(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenAPI spec from ${url} (${response.status})`)
  }
  return (await response.json()) as OpenAPIDocument
}

async function readSource(config: ApiSpecConfig): Promise<OpenAPIDocument> {
  switch (config.source.type) {
    case 'file':
      return readFromFile(config.source.path)
    case 'url':
      return readFromUrl(config.source.url, config.source.headers)
    case 'inline':
      return config.source.document
    default:
      throw new Error(`Unsupported OpenAPI source: ${(config as { source: { type: string } }).source.type}`)
  }
}

export async function loadSpecDocument(config: ApiSpecConfig): Promise<OpenAPIDocument> {
  const key = cacheKey(config)
  if (!specCache.has(key)) {
    specCache.set(key, readSource(config))
  }
  return specCache.get(key) as Promise<OpenAPIDocument>
}

export async function loadSpec(config: ApiSpecConfig): Promise<ResolvedSpec> {
  const document = await loadSpecDocument(config)
  return { config, document }
}

export async function loadSpecs(configs: Array<ApiSpecConfig>) {
  return Promise.all(configs.map((config) => loadSpec(config)))
}

export function getSpecConfig(reference: ApiReferenceConfig, specId?: string) {
  const resolvedId = specId ?? reference.defaultSpecId
  const spec = reference.specs.find((entry) => entry.id === resolvedId)
  if (!spec) {
    throw new Error(`Unknown API reference spec: ${resolvedId}`)
  }
  return spec
}

