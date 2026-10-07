'use client'

/** On-demand server search dialog kept outside the initial docs bundle. */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

interface SearchResult {
  type?: 'page' | 'api_operation'
  page_id: string
  title: string
  description: string
  url: string
  /** Deep link to the best-matching section, when the match sits under a heading. */
  section_url?: string
  method?: string
  path?: string
  snippet?: string
}

interface SearchResponse {
  results?: Array<SearchResult>
}

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale?: string
}

function trackSearch(payload: { query: string; resultCount?: number; clickedSlug?: string }) {
  try {
    const body = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/search/track', new Blob([body], { type: 'application/json' }))
    } else {
      void fetch('/api/search/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      })
    }
  } catch {
    // Search analytics must never interrupt navigation.
  }
}

function toLocalHref(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return value
  }
}

export function SearchDialog({ open, onOpenChange, locale }: SearchDialogProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<SearchResult>>([])
  const [loading, setLoading] = useState(false)
  const lastTrackedRef = useRef('')

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length < 2) return

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(normalized)}&limit=8&mode=fulltext${locale ? `&locale=${encodeURIComponent(locale)}` : ''}`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(`Search failed with ${response.status}`)
        const data = (await response.json()) as SearchResponse
        setResults(data.results ?? [])
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 160)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query, locale])

  const visibleResults = query.trim().length >= 2 ? results : []

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      const normalized = query.trim()
      if (normalized.length >= 2 && normalized !== lastTrackedRef.current) {
        lastTrackedRef.current = normalized
        trackSearch({ query: normalized, resultCount: visibleResults.length })
      }
    }
    onOpenChange(nextOpen)
  }

  function handleSelect(result: SearchResult) {
    const normalized = query.trim()
    if (normalized) {
      trackSearch({ query: normalized, clickedSlug: result.page_id })
      lastTrackedRef.current = normalized
    }
    router.push(toLocalHref(result.section_url ?? result.url))
    onOpenChange(false)
  }

  const emptyMessage =
    query.trim().length < 2
      ? 'Type at least 2 characters to search.'
      : loading
        ? 'Searching…'
        : 'No matches found.'

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages, concepts, or content..."
        />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>
          {visibleResults.length > 0 ? (
            <CommandGroup heading="Documents">
              {visibleResults.map((result) => (
                <CommandItem
                  key={result.page_id}
                  value={result.page_id}
                  onSelect={() => handleSelect(result)}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">
                      {result.method ? <span className="mr-2 font-mono text-xs uppercase text-foreground/60">{result.method}</span> : null}
                      {result.title}
                    </span>
                    <span className="truncate text-xs text-foreground/60">
                      {result.description || result.snippet}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
