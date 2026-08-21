'use client'

/** Page-wide conditional views and legacy iframe embedding aliases. */

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Icon } from '@/components/mdx/content-icon'
import { usePageSlots } from '@/components/mdx/page-slots'

interface ViewProps {
  title: string
  icon?: string
  iconType?: 'regular' | 'solid' | 'outline'
  children?: ReactNode
}

/** Render content selected by the shared view switcher for this page. */
export function View({ title, icon, iconType, children }: ViewProps) {
  const { activeView, registerView, setActiveView, views } = usePageSlots()
  useEffect(() => registerView({ title, icon, iconType }), [icon, iconType, registerView, title])
  const isFirst = views[0]?.title === title
  // Keep server output complete for crawlers; registration selects the first
  // view immediately after hydration.
  const isActive = !activeView || activeView === title
  // The selector must live inside the visible View. Keeping it permanently in
  // the first View would hide the controls as soon as another View is chosen.
  const rendersSwitcher = activeView ? isActive : isFirst

  return (
    <section className={isActive ? 'contents' : 'hidden'} data-mdx-view={title} aria-hidden={!isActive}>
      {rendersSwitcher ? (
        <div className="not-prose mb-6 flex flex-wrap gap-2" role="group" aria-label="Content view">
          {views.map((view) => (
            <button
              key={view.title}
              type="button"
              aria-pressed={activeView === view.title}
              onClick={() => setActiveView(view.title)}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm aria-pressed:border-foreground/40 aria-pressed:bg-muted"
            >
              {view.icon ? <Icon icon={view.icon} className="h-4 w-4" /> : null}
              {view.title}
            </button>
          ))}
        </div>
      ) : null}
      {children}
    </section>
  )
}

interface EmbedProps {
  src: string
  height?: number | string
  title?: string
}

function isSafeEmbedSource(src: string): boolean {
  return (src.startsWith('/') && !src.startsWith('//') && !src.includes('\\')) || /^https:\/\//i.test(src)
}

/** Legacy sandboxed iframe. Prefer View for conditional content. */
export function Embed({ src, height = 500, title = 'Live preview' }: EmbedProps) {
  if (!isSafeEmbedSource(src)) return null
  const resolvedHeight = typeof height === 'number' ? `${height}px` : height
  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border border-border/40 bg-muted/20">
      <iframe src={src} title={title} style={{ height: resolvedHeight }} className="w-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" loading="lazy" />
    </div>
  )
}

export const LegacyView = Embed
