import type { ComponentType } from 'react'

type Registry = Record<string, Record<string, () => Promise<ComponentType<Record<string, unknown>>>>>

const registry: Registry = {}

export function registerSnippetComponent(
  snippetPath: string,
  name: string,
  loader: () => Promise<ComponentType<Record<string, unknown>>>,
) {
  registry[snippetPath] ??= {}
  registry[snippetPath][name] = loader
}

export function resolveSnippetComponent(path: string, name: string) {
  const loader = registry[path]?.[name]
  return loader ?? null
}

export function listRegisteredSnippets(): Array<string> {
  return Object.keys(registry)
}
