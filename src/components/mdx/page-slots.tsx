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
  useMemo,
  useState,
} from 'react'

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
}

const PageSlotsContext = createContext<PageSlotsValue | null>(null)

export function PageSlotsProvider({ children }: { children: ReactNode }) {
  const [panelTarget, setPanelTarget] = useState<HTMLElement | null>(null)
  const [panelCount, setPanelCount] = useState(0)
  const [views, setViews] = useState<Array<ViewOption>>([])
  const [activeView, setActiveViewState] = useState<string>()

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
  }), [activeView, panelCount, panelTarget, registerPanel, registerView, setActiveView, views])

  return <PageSlotsContext.Provider value={value}>{children}</PageSlotsContext.Provider>
}

/** Access the current documentation page's MDX coordination slots. */
export function usePageSlots(): PageSlotsValue {
  const value = useContext(PageSlotsContext)
  if (!value) throw new Error('MDX page slot components must render inside PageSlotsProvider')
  return value
}

/** Desktop destination for canonical Panel content. */
export function PagePanelSlot({ fallback }: { fallback: ReactNode }) {
  const { panelCount, setPanelTarget } = usePageSlots()
  return (
    <div ref={setPanelTarget} className="sticky top-[82px] max-h-[calc(100dvh-82px)] overflow-y-auto">
      {panelCount === 0 ? fallback : null}
    </div>
  )
}
