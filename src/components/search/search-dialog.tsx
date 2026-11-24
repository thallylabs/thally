'use client'

/** On-demand server search dialog kept outside the initial docs bundle. */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useDocsCodeActions } from '@/components/docs/code-actions-provider'
import {
  Command,
  CommandDialog,
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
  related?: Array<SearchResult>
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

function SearchResultRow({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  return (
    <CommandItem value={result.page_id} onSelect={onSelect}>
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
  )
}

export function SearchDialog({ open, onOpenChange, locale }: SearchDialogProps) {
  const router = useRouter()
  const { hasAssistantEntryPoint, assistantLabel, openAssistant, openAssistantWithPrompt } = useDocsCodeActions()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<SearchResult>>([])
  const [related, setRelated] = useState<Array<SearchResult>>([])
  const [loading, setLoading] = useState(false)
  const lastTrackedRef = useRef('')

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length < 2) {
      setLoading(false)
      setResults([])
      setRelated([])
      return
    }

    setLoading(true)
    setResults([])
    setRelated([])
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(normalized)}&limit=8&mode=fulltext${locale ? `&locale=${encodeURIComponent(locale)}` : ''}`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(`Search failed with ${response.status}`)
        const data = (await response.json()) as SearchResponse
        setResults(data.results ?? [])
        setRelated(data.related ?? [])
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setResults([])
          setRelated([])
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 160)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query, locale])

  const normalizedQuery = query.trim()
  const isSearchable = normalizedQuery.length >= 2
  const visibleResults = isSearchable ? results : []
  const visibleRelated = isSearchable && visibleResults.length === 0 ? related : []
  const assistantName = assistantLabel.trim() || 'AI'
  const askLabel = /^ask\b/i.test(assistantName) ? assistantName : `Ask ${assistantName}`
  const assistantActionLabel = normalizedQuery ? `${askLabel} about "${normalizedQuery}"` : askLabel
  const showAssistant = hasAssistantEntryPoint
    && (!isSearchable || (!loading && visibleResults.length === 0))
  const showNoResults = isSearchable && !loading && visibleResults.length === 0 && visibleRelated.length === 0

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSearchable && normalizedQuery !== lastTrackedRef.current) {
      lastTrackedRef.current = normalizedQuery
      trackSearch({ query: normalizedQuery, resultCount: visibleResults.length })
    }
    onOpenChange(nextOpen)
  }

  function handleSelect(result: SearchResult) {
    if (normalizedQuery) {
      trackSearch({ query: normalizedQuery, clickedSlug: result.page_id })
      lastTrackedRef.current = normalizedQuery
    }
    router.push(toLocalHref(result.section_url ?? result.url))
    onOpenChange(false)
  }

  function handleAskAssistant() {
    if (normalizedQuery) {
      openAssistantWithPrompt(normalizedQuery)
    } else {
      openAssistant()
    }
    handleOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search pages, concepts, or content..."
        />
        <CommandList>
          {!isSearchable && !hasAssistantEntryPoint ? (
            <div className="py-6 text-center text-sm text-foreground/60">
              Type at least 2 characters to search.
            </div>
          ) : null}
          {isSearchable && loading ? (
            <div className="py-6 text-center text-sm text-foreground/60">Searching…</div>
          ) : null}
          {visibleResults.length > 0 ? (
            <CommandGroup heading="Documents">
              {visibleResults.map((result) => (
                <SearchResultRow
                  key={result.page_id}
                  result={result}
                  onSelect={() => handleSelect(result)}
                />
              ))}
            </CommandGroup>
          ) : null}
          {visibleRelated.length > 0 ? (
            <CommandGroup heading="Related">
              {visibleRelated.map((result) => (
                <SearchResultRow
                  key={result.page_id}
                  result={result}
                  onSelect={() => handleSelect(result)}
                />
              ))}
            </CommandGroup>
          ) : null}
          {showNoResults ? (
            <div className="py-6 text-center text-sm text-foreground/60">
              {`No results for "${normalizedQuery}".`}
            </div>
          ) : null}
          {showAssistant ? (
            <CommandGroup>
              <CommandItem value="ask-assistant" onSelect={handleAskAssistant} className="items-start">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-foreground/60" aria-hidden="true" />
                <span className="min-w-0 text-sm font-medium">{assistantActionLabel}</span>
              </CommandItem>
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
