'use client'

import { create, insertMultiple, search } from '@orama/orama'
import type { Orama } from '@orama/orama'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { parseAsString, useQueryState } from 'nuqs'
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
import { cn } from '@/lib/utils'

const parser = parseAsString.withDefault('')

export interface SearchCorpusRecord {
  id: string
  pageId: string
  title: string
  description: string
  headings: string
  body: string
  keywords: string
  href: string
}

interface CommandSearchProps {
  searchIndex: Array<SearchCorpusRecord>
}

type ClientDb = Orama<{
  title: 'string'
  description: 'string'
  headings: 'string'
  body: 'string'
  keywords: 'string'
}>

/** Best-effort beacon of a search / result click to the admin Search analytics. */
function trackSearch(payload: { query: string; resultCount?: number; clickedSlug?: string }) {
  try {
    const body = JSON.stringify(payload)
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
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
    // never let analytics break search
  }
}

export function CommandSearch({ searchIndex }: CommandSearchProps) {
  const router = useRouter()
  const [query, setQuery] = useQueryState('q', parser)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Array<SearchCorpusRecord>>(() => searchIndex.slice(0, 6))
  const dbRef = useRef<ClientDb | null>(null)

  // Build the in-browser full-text index once. Body-aware + typo tolerant, and
  // sourced from the same content corpus as the server hybrid index.
  useEffect(() => {
    let cancelled = false
    const db = create({
      schema: {
        title: 'string',
        description: 'string',
        headings: 'string',
        body: 'string',
        keywords: 'string',
      },
    }) as ClientDb
    Promise.resolve(
      insertMultiple(
        db,
        searchIndex.map((record) => ({
          id: record.id,
          title: record.title,
          description: record.description,
          headings: record.headings,
          body: record.body,
          keywords: record.keywords,
        })),
      ),
    ).then(() => {
      if (!cancelled) dbRef.current = db
    })
    return () => {
      cancelled = true
    }
  }, [searchIndex])

  useEffect(() => {
    const normalized = query.trim()
    if (!normalized) {
      setResults(searchIndex.slice(0, 6))
      return
    }
    const db = dbRef.current
    if (!db) return

    let cancelled = false
    const handle = setTimeout(() => {
      Promise.resolve(
        search(db, {
          term: normalized,
          properties: ['title', 'description', 'headings', 'body', 'keywords'],
          boost: { title: 3, headings: 2, description: 1.5, keywords: 1.5 },
          tolerance: 1,
          limit: 8,
        }),
      ).then((response) => {
        if (cancelled) return
        const byId = new Map(searchIndex.map((record) => [record.id, record]))
        const hits = response.hits
          .map((hit) => byId.get((hit.document as { id: string }).id))
          .filter((record): record is SearchCorpusRecord => Boolean(record))
        setResults(hits)
      })
    }, 60)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, searchIndex])

  // Record the FINAL query when the palette closes (never per keystroke), plus
  // result clicks in handleSelect — so we log "changelog", not "c/ch/cha/…".
  const lastTrackedRef = useRef<string>('')
  useEffect(() => {
    if (open) return // only act on close
    const q = query.trim()
    if (q.length >= 2 && q !== lastTrackedRef.current) {
      lastTrackedRef.current = q
      trackSearch({ query: q, resultCount: results.length })
    }
  }, [open, query, results])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function handleSelect(href: string, id: string) {
    const q = query.trim()
    if (q) trackSearch({ query: q, clickedSlug: id })
    router.push(href)
    setOpen(false)
  }

  return (
    <>
      <button
        className="hidden h-10 flex-1 items-center gap-3 rounded-[var(--theme-control-radius)] border border-border/70 px-4 text-left text-sm text-foreground/70 transition hover:border-border lg:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-foreground/50" />
        <span className="flex-1 truncate">{query ? query : 'Search the docs'}</span>
        <kbd className="rounded-md border border-border/70 bg-muted px-2 py-0.5 text-[10px] text-foreground/60">
          ⌘K
        </kbd>
      </button>

      <button
        className="flex h-10 w-10 items-center justify-center rounded-[var(--theme-control-radius)] border border-border/70 text-foreground/60 lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="sr-only">Search</span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={(value) => setQuery(value ? value : null)} placeholder="Search pages, concepts, or content..." />
          <CommandList>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup heading="Documents">
              {results.map((doc) => {
                const tag = doc.keywords.split(' ').filter(Boolean)[0]
                return (
                  <CommandItem key={doc.id} value={doc.id} onSelect={() => handleSelect(doc.href, doc.id)}>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{doc.title}</span>
                      <span className="text-xs text-foreground/60">{doc.description}</span>
                    </div>
                    {tag ? (
                      <span className={cn('ml-auto text-xs uppercase tracking-wide text-foreground/50')}>
                        {tag}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
