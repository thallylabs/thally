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
        className="hidden h-10 flex-1 items-center gap-3 rounded-[var(--theme-control-radius)] border border-border/70 px-4 text-left text-sm text-foreground/70 transition hover:border-border lg:flex"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4 text-foreground/50" />
        <span className="flex-1 truncate">Search the docs</span>
        <kbd className="rounded-md border border-border/70 bg-muted px-2 py-0.5 text-[10px] text-foreground/60">
          ⌘K
        </kbd>
      </button>

      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Search the docs"
        className="flex h-10 w-10 items-center justify-center rounded-[var(--theme-control-radius)] border border-border/70 text-foreground/60 lg:hidden"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
      </button>

      {open ? <SearchDialog open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}
