'use client'

/** Configurable page context actions, with explicit clipboard feedback and roving menu focus. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, ExternalLink, FileText, Plug, Sparkles } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { agentServerName } from '@/lib/agent-identity'
import { DEFAULT_PAGE_ACTIONS, MCP_PAGE_ACTIONS, PAGE_ACTIONS, mcpPageActions, pageMarkdownPath, type PageActionsConfig } from '@/lib/page-actions'
import { cn } from '@/lib/utils'

interface MenuItem {
  id: string
  label: string
  description?: string
  icon: ReactNode
  href?: string
  copy?: 'page' | 'mcp'
}

type CopyState = 'idle' | 'copied' | 'failed'

/** Copy the current page or connect a reader's tools to this documentation site. */
export function CopyPageButton({ options = DEFAULT_PAGE_ACTIONS, serverName = agentServerName('Documentation'), markdown }: PageActionsConfig) {
  const pathname = usePathname()
  const menuId = useId()
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [open, setOpen] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState<boolean | null>(null)
  const [origin, setOrigin] = useState('')
  const [menuPlacement, setMenuPlacement] = useState({ above: false, maxHeight: 480 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configured = [...new Set(options)].filter((id) => PAGE_ACTIONS.some((known) => known === id))
  const needsMcp = configured.some((id) => MCP_PAGE_ACTIONS.some((known) => known === id))

  useEffect(() => {
    setOrigin(window.location.origin)
    return () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current) }
  }, [])

  useEffect(() => {
    if (!open || !needsMcp || mcpEnabled !== null) return
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort(); setMcpEnabled(false) }, 8000)
    // Capability is non-secret and fetched only on demand. Failure hides install
    // actions; copying and reading Markdown must remain available independently.
    void fetch('/api/site-config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Site capabilities unavailable')
        const config: { mcpEnabled?: unknown } = await response.json()
        if (!controller.signal.aborted) setMcpEnabled(config.mcpEnabled === true)
      })
      .catch(() => { if (!controller.signal.aborted) setMcpEnabled(false) })
    return () => { clearTimeout(timeout); controller.abort() }
  }, [open, needsMcp, mcpEnabled])

  function openMenu(position: 'first' | 'last') {
    initialFocus.current = position
    if (!open && needsMcp) setMcpEnabled(null)
    setOpen(true)
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    function measure() {
      const bounds = containerRef.current?.getBoundingClientRect()
      if (!bounds) return
      const below = window.innerHeight - bounds.bottom - 24
      const above = bounds.top - 24
      const isAbove = below < 240 && above > below
      setMenuPlacement({ above: isAbove, maxHeight: Math.max(64, isAbove ? above : below) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  useEffect(() => {
    if (!open || menuRef.current?.contains(document.activeElement)) return
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    const target = initialFocus.current === 'last' ? items?.[items.length - 1] : items?.[0]
    target?.focus()
  }, [open, mcpEnabled])

  useEffect(() => {
    if (!open) return
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function feedback(state: CopyState) {
    setCopyState(state)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setCopyState('idle'), 2000)
  }

  async function handleCopy(kind: 'page' | 'mcp' = 'page') {
    // Snapshot content before fetching: a reader may reopen the menu while the
    // mirror responds. Never copy menu labels, clipboard announcements or chrome.
    const article = kind === 'page' && !markdown ? document.querySelector('article')?.cloneNode(true) as HTMLElement | undefined : undefined
    article?.querySelectorAll('[data-page-actions], [role="menu"], [role="status"]').forEach((node) => node.remove())
    const fallback = article?.innerText || article?.textContent?.trim() || null
    if (open) closeMenu(true)
    try {
      let text: string | null
      if (kind === 'mcp') {
        text = mcpPageActions(window.location.origin, serverName).command
      } else if (markdown) {
        text = markdown
      } else {
        // Mirror-disabled sites still offer their rendered article as before.
        const response = await fetch(pageMarkdownPath(pathname))
        text = response.ok ? await response.text() : fallback
      }
      if (!text) throw new Error('No page content available')
      await navigator.clipboard.writeText(text)
      feedback('copied')
    } catch {
      feedback('failed')
    }
  }

  const mdPath = pageMarkdownPath(pathname)
  const prompt = encodeURIComponent(`Read ${origin}${mdPath} and help me with questions about this page.`)
  const installs = origin ? mcpPageActions(origin, serverName) : null
  const actions: Array<MenuItem> = [
    { id: 'copy', label: 'Copy page', description: 'Copy page as Markdown for LLMs', icon: <Copy />, copy: 'page' },
    { id: 'view', label: 'View as Markdown', icon: <FileText />, href: mdPath },
    { id: 'llms-full', label: 'llms-full.txt', description: 'View all docs as Markdown for LLMs', icon: <FileText />, href: `${origin}/llms-full.txt` },
    { id: 'mcp', label: 'Copy MCP install command', description: 'Copy npx command to install MCP server', icon: <Plug />, copy: 'mcp' },
    { id: 'cursor', label: 'Connect to Cursor', description: 'Install MCP Server on Cursor', icon: <ExternalLink />, href: installs?.cursor },
    { id: 'vscode', label: 'Connect to VS Code', description: 'Install MCP Server on VS Code', icon: <ExternalLink />, href: installs?.vscode },
    { id: 'chatgpt', label: 'Open in ChatGPT', icon: <Sparkles />, href: `https://chatgpt.com/?q=${prompt}` },
    { id: 'claude', label: 'Open in Claude', icon: <Sparkles />, href: `https://claude.ai/new?q=${prompt}` },
    { id: 'perplexity', label: 'Open in Perplexity', icon: <Sparkles />, href: `https://www.perplexity.ai/search?q=${prompt}` },
  ]
  const items = configured.flatMap((id) => {
    if (MCP_PAGE_ACTIONS.some((known) => known === id) && mcpEnabled !== true) return []
    return actions.filter((item) => item.id === id)
  })
  const isCheckingMcp = needsMcp && mcpEnabled === null
  if (!items.length && !isCheckingMcp) return null

  const menuItemClass = 'flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm text-foreground/80 transition hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:text-foreground [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0'
  return (
    <div ref={containerRef} data-page-actions className="relative flex h-[34px] shrink-0 items-stretch rounded-[9px] border border-border"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false) }}
      onKeyDown={(event) => {
        if (!open) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return }
        if (event.key === 'Tab') { closeMenu(true); return }
        if (!menuRef.current?.contains(event.target as Node) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const controls = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        const index = controls.indexOf(document.activeElement as HTMLElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
        controls[next]?.focus()
      }}>
      {configured.includes('copy') ? <Button variant="ghost" size="sm" onClick={() => void handleCopy()} className="gap-1.5 rounded-r-none pr-2 text-xs text-muted-foreground hover:text-foreground" aria-label="Copy page as markdown">
        {copyState === 'copied' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? "Couldn't copy" : 'Copy page'}
      </Button> : null}
      <Button ref={triggerRef} variant="ghost" size="sm" onClick={() => { if (open) closeMenu(); else openMenu('first') }}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(event.key === 'ArrowUp' ? 'last' : 'first') } }}
        className={cn('px-1.5 text-muted-foreground hover:text-foreground', configured.includes('copy') ? 'rounded-l-none border-l border-border/50' : 'gap-1.5 pl-2.5 text-xs')}
        aria-label="More page actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}>
        {configured.includes('copy') ? null : 'Page actions'}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>
      <span role="status" className="sr-only">{copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? "Couldn't copy to clipboard" : ''}</span>
      {open ? <div ref={menuRef} id={menuId} role="menu" aria-label="Page actions" style={{ maxHeight: menuPlacement.maxHeight }} className={cn("absolute right-0 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg", menuPlacement.above ? "bottom-full mb-1.5" : "top-full mt-1.5")}>
        {items.map((item) => {
          const content = <>{item.icon}<span className="min-w-0 flex-1"><span className="block font-medium">{item.label}</span>{item.description ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.description}</span> : null}</span></>
          return item.copy ? <button key={item.id} type="button" role="menuitem" tabIndex={-1} className={menuItemClass} onClick={() => void handleCopy(item.copy)}>{content}</button>
            : <a key={item.id} role="menuitem" tabIndex={-1} href={item.href} target="_blank" rel="noopener noreferrer" className={menuItemClass} onClick={() => closeMenu(true)}>{content}</a>
        })}
        {!items.length && isCheckingMcp ? <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">Checking MCP availability…</p> : null}
      </div> : null}
    </div>
  )
}
