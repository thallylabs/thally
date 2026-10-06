'use client'

/**
 * Page-scoped coordination for MDX that contributes content outside the
 * article flow. The provider keeps the MDX tree authoritative while portals
 * let desktop layouts place supplementary content in the detail column.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  startTransition,
  useMemo,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { isChangelogPath, matchesSelectedTags, parseTagsParam, tagsByCount, validSelectedTags } from '@/lib/update-filters'

interface ViewOption {
  title: string
  icon?: string
  iconType?: string
}

interface PageSlotsValue {
  panelTarget: HTMLElement | null
  setPanelTarget: (target: HTMLElement | null) => void
  panelCount: number
  registerPanel: () => () => void
  views: Array<ViewOption>
  activeView?: string
  setActiveView: (title: string) => void
  registerView: (view: ViewOption) => () => void
  /** Changelog `<Update tags>` usage counts, and the tags the reader filtered by. */
  tagCounts: Record<string, number>
  selectedTags: Array<string>
  /** Registered Update entries, and how many the current filter shows. */
  updateTotal: number
  updateShown: number
  registerTags: (tags: ReadonlyArray<string>) => () => void
  toggleTag: (tag: string) => void
  clearTags: () => void
}

const PageSlotsContext = createContext<PageSlotsValue | null>(null)

/** Like `usePageSlots`, but null outside a provider so standalone renders still work. */
export function usePageSlotsOptional(): PageSlotsValue | null {
  return useContext(PageSlotsContext)
}

function writeTagsParam(tags: ReadonlyArray<string>) {
  const url = new URL(window.location.href)
  url.searchParams.delete('tags')
  for (const tag of tags) url.searchParams.append('tags', tag)
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

export function PageSlotsProvider({ children }: { children: ReactNode }) {
  const [panelTarget, setPanelTarget] = useState<HTMLElement | null>(null)
  const [panelCount, setPanelCount] = useState(0)
  const [views, setViews] = useState<Array<ViewOption>>([])
  const [activeView, setActiveViewState] = useState<string>()

  const [entries, setEntries] = useState<Array<ReadonlyArray<string>>>([])
  const [rawSelectedTags, setSelectedTags] = useState<Array<string> | null>(null)
  const [urlSearch, setUrlSearch] = useState('')
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tags of entries) for (const tag of tags) counts[tag] = (counts[tag] ?? 0) + 1
    return counts
  }, [entries])
  // Selected tags no Update carries (a stale shared link) are ignored rather than hiding everything.
  // Until the reader changes the filter, the shared URL is resolved against the registered tags, so a tag that contains a comma is not split.
  const selectedTags = useMemo(
    () => validSelectedTags(rawSelectedTags ?? parseTagsParam(urlSearch, tagCounts), tagCounts),
    [rawSelectedTags, tagCounts, urlSearch],
  )

  // Read the shared filter after hydration so server and client markup match.
  useEffect(() => {
    const search = window.location.search
    if (search) startTransition(() => setUrlSearch(search))
  }, [])

  const registerTags = useCallback((tags: ReadonlyArray<string>) => {
    setEntries((current) => [...current, tags])
    return () => setEntries((current) => current.filter((entry) => entry !== tags))
  }, [])

  const updateTotal = entries.length
  const updateShown = useMemo(() => entries.filter((tags) => matchesSelectedTags(tags, selectedTags)).length, [entries, selectedTags])

  const toggleTag = useCallback((tag: string) => {
    const next = selectedTags.includes(tag) ? selectedTags.filter((item) => item !== tag) : [...selectedTags, tag]
    setSelectedTags(next)
    writeTagsParam(next)
  }, [selectedTags])

  const clearTags = useCallback(() => {
    setSelectedTags([])
    writeTagsParam([])
  }, [])

  const registerPanel = useCallback(() => {
    setPanelCount((count) => count + 1)
    return () => setPanelCount((count) => Math.max(0, count - 1))
  }, [])

  const registerView = useCallback((view: ViewOption) => {
    setViews((current) => current.some(({ title }) => title === view.title) ? current : [...current, view])
    setActiveViewState((current) => current ?? view.title)
    return () => {
      setViews((current) => current.filter(({ title }) => title !== view.title))
      setActiveViewState((current) => current === view.title ? undefined : current)
    }
  }, [])

  const setActiveView = useCallback((title: string) => {
    setActiveViewState(title)
  }, [])

  useEffect(() => {
    if (!activeView) return
    window.dispatchEvent(new CustomEvent('thally:view-change', { detail: { title: activeView } }))
  }, [activeView])

  const value = useMemo(() => ({
    panelTarget,
    setPanelTarget,
    panelCount,
    registerPanel,
    views,
    activeView,
    setActiveView,
    registerView,
    tagCounts,
    selectedTags,
    updateTotal,
    updateShown,
    registerTags,
    toggleTag,
    clearTags,
  }), [activeView, clearTags, panelCount, panelTarget, registerPanel, registerTags, registerView, selectedTags, setActiveView, tagCounts, toggleTag, updateShown, updateTotal, views])

  return <PageSlotsContext.Provider value={value}>{children}</PageSlotsContext.Provider>
}

/** Access the current documentation page's MDX coordination slots. */
export function usePageSlots(): PageSlotsValue {
  const value = useContext(PageSlotsContext)
  if (!value) throw new Error('MDX page slot components must render inside PageSlotsProvider')
  return value
}

/** Desktop destination for canonical Panel content and persistent rail actions. */
export function PagePanelSlot({
  fallback,
  footer,
}: {
  fallback: ReactNode
  footer?: ReactNode
}) {
  const { panelCount, setPanelTarget, tagCounts } = usePageSlots()
  // Mintlify's changelog swaps the table of contents for its filters; any other page
  // with tagged updates keeps its table of contents beneath the filters.
  const hasTags = tagsByCount(tagCounts).length > 0
  const changelog = isChangelogPath(usePathname())
  return (
    <div className="sticky top-[82px] max-h-[calc(100dvh-82px)] overflow-y-auto">
      <div ref={setPanelTarget}>
        {panelCount === 0 ? (hasTags ? (changelog ? <UpdateFilterPanel /> : <><UpdateFilterPanel />{fallback}</>) : fallback) : null}
      </div>
      {footer}
    </div>
  )
}

/** Tag chips for a changelog; chips toggle, any selected tag shows an entry. `idPrefix` keeps ids unique when two copies render. */
export function UpdateFilterControls({
  tagCounts,
  selectedTags,
  updateShown,
  updateTotal,
  onToggle,
  onClear,
  className = '',
  idPrefix = 'changelog',
}: {
  tagCounts: Record<string, number>
  selectedTags: ReadonlyArray<string>
  updateShown: number
  updateTotal: number
  onToggle: (tag: string) => void
  onClear: () => void
  className?: string
  idPrefix?: string
}) {
  return (
    <div className={`space-y-4 text-sm ${className}`} id={`${idPrefix}-filters`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground/80">Filters</span>
        {selectedTags.length ? (
          <button type="button" onClick={onClear} className="rounded-full px-3 text-sm font-medium text-foreground/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Clear
          </button>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">Showing {updateShown} of {updateTotal} updates</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter updates by tag">
        {tagsByCount(tagCounts).map((tag) => {
          const pressed = selectedTags.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(tag)}
              className={`rounded-full px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${pressed ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground/70 hover:bg-muted/70'}`}
            >
              {tag}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Right-rail copy of the filters. */
function UpdateFilterPanel() {
  const { tagCounts, selectedTags, toggleTag, clearTags, updateShown, updateTotal } = usePageSlots()
  return <UpdateFilterControls tagCounts={tagCounts} selectedTags={selectedTags} updateShown={updateShown} updateTotal={updateTotal} onToggle={toggleTag} onClear={clearTags} />
}

/**
 * In-article copy of the filters for layouts where the detail column does not carry them: below xl,
 * without a detail column, or when a Panel replaces the rail content. Without it a shared `?tags=` link
 * hides updates with no visible way to see them again.
 */
export function InlineUpdateFilters({ railVisible }: { railVisible: boolean }) {
  const { tagCounts, selectedTags, toggleTag, clearTags, updateShown, updateTotal, panelCount } = usePageSlots()
  if (tagsByCount(tagCounts).length === 0) return null
  const railShowsFilters = railVisible && panelCount === 0
  return (
    <UpdateFilterControls
      className={railShowsFilters ? 'not-prose xl:hidden' : 'not-prose'}
      idPrefix="changelog-inline"
      tagCounts={tagCounts}
      selectedTags={selectedTags}
      updateShown={updateShown}
      updateTotal={updateTotal}
      onToggle={toggleTag}
      onClear={clearTags}
    />
  )
}
