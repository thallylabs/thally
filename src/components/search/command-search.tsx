'use client'

/** Small search trigger; the dialog and search logic load only on demand. */

import dynamic from 'next/dynamic'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'

const SearchDialog = dynamic(
  () => import('@/components/search/search-dialog').then((module) => module.SearchDialog),
)

export function CommandSearch() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Search the docs"
        className="hidden h-9 flex-1 items-center gap-3 rounded-[10px] border-0 bg-muted px-3 text-left text-sm text-foreground/70 transition hover:text-foreground lg:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-foreground/50" />
        <span className="flex-1 truncate">Search the docs</span>
        <kbd className="rounded-[5px] border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground/60">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Search the docs"
        className="flex h-9 w-9 items-center justify-center rounded-[10px] border-0 text-foreground/60 hover:bg-muted hover:text-foreground lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
      </button>

      {open ? <SearchDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
