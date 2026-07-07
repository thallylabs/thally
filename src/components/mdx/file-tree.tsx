'use client'

import { useState } from 'react'
import { ChevronRight, File as FileIcon, Folder as FolderIcon, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

interface TreeProps {
  children: React.ReactNode
}

export function Tree({ children }: TreeProps) {
  return (
    <div className="not-prose my-6 rounded-2xl border border-border/40 bg-muted/30 p-4 font-mono text-sm">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

interface FolderProps {
  name: string
  defaultOpen?: boolean
  children?: React.ReactNode
}

export function Folder({ name, defaultOpen = false, children }: FolderProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded py-1 hover:text-foreground text-foreground/80 transition"
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-foreground/40 transition-transform', open && 'rotate-90')} />
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
        ) : (
          <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
        )}
        <span>{name}</span>
      </button>
      {open && children ? (
        <div className="ml-5 border-l border-border/40 pl-3">{children}</div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

interface FileProps {
  name: string
}

export function File({ name }: FileProps) {
  return (
    <div className="flex items-center gap-1.5 py-1 text-foreground/60">
      <FileIcon className="h-4 w-4 shrink-0 text-foreground/30" />
      <span>{name}</span>
    </div>
  )
}
