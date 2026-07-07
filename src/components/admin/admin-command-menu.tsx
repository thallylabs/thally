'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  ExternalLink,
  FileJson,
  Gauge,
  Home,
  LogOut,
  MoonStar,
  Settings,
  Sun,
} from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandDialog,
} from '@/components/ui/command'

interface AdminCommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogout: () => void
}

const PAGES = [
  { href: '/admin', label: 'Home', icon: Home },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/agent-readiness', label: 'Agent Readiness', icon: Gauge },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
]

const ENDPOINTS = [
  { href: '/', label: 'Open live site', icon: ExternalLink },
  { href: '/llms.txt', label: 'llms.txt', icon: FileJson },
  { href: '/ai.txt', label: 'ai.txt', icon: FileJson },
  { href: '/api/docs-index', label: 'docs-index', icon: FileJson },
  { href: '/api/agent-readiness', label: 'agent-readiness (JSON)', icon: FileJson },
]

export function AdminCommandMenu({ open, onOpenChange, onLogout }: AdminCommandMenuProps) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  function go(href: string, external = false) {
    onOpenChange(false)
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(href)
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command loop>
        <CommandInput placeholder="Search admin, jump to a page, or run a command…" autoFocus />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          <CommandGroup heading="Go to">
            {PAGES.map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={`go ${label}`} onSelect={() => go(href)}>
                <Icon className="h-4 w-4 opacity-70" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Agent endpoints">
            {ENDPOINTS.map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={`open ${label}`} onSelect={() => go(href, true)}>
                <Icon className="h-4 w-4 opacity-70" />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Actions">
            <CommandItem
              value="toggle theme appearance"
              onSelect={() => {
                setTheme(isDark ? 'light' : 'dark')
                onOpenChange(false)
              }}
            >
              {isDark ? <Sun className="h-4 w-4 opacity-70" /> : <MoonStar className="h-4 w-4 opacity-70" />}
              Switch to {isDark ? 'light' : 'dark'} theme
            </CommandItem>
            <CommandItem
              value="sign out log out"
              onSelect={() => {
                onOpenChange(false)
                onLogout()
              }}
            >
              <LogOut className="h-4 w-4 opacity-70" />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
