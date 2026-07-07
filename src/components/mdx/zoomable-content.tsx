'use client'

import { useState, type ReactNode } from 'react'

interface ZoomableContentProps {
  children: ReactNode
}

export function ZoomableContent({ children }: ZoomableContentProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className="cursor-zoom-in"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {children}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          role="button"
          tabIndex={0}
        >
          <div className="max-h-[90vh] max-w-[90vw] overflow-auto rounded-2xl border border-border/40 bg-background shadow-2xl">
            {children}
          </div>
        </div>
      ) : null}
    </>
  )
}
