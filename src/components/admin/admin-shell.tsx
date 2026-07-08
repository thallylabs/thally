'use client'

import '@/styles/design-system.css'

import { useState, useSyncExternalStore, type ComponentType } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  BarChart3,
  ExternalLink,
  Gauge,
  Home,
  LogOut,
  Menu,
  MoonStar,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Plug,
  Search,
  ListChecks,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { AdminCommandMenu } from '@/components/admin/admin-command-menu'
import { BrandMark } from '@/components/admin/brand-mark'

interface NavItem {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

interface NavGroup {
  label: string
  items: Array<NavItem>
}

const NAV: Array<NavGroup> = [
  {
    label: 'Workspace',
    items: [
      { href: '/admin', label: 'Home', icon: Home },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/agent-readiness', label: 'Agent Readiness', icon: Gauge },
      { href: '/admin/tasks', label: 'Docs tasks', icon: ListChecks },
      { href: '/admin/mcp', label: 'MCP server', icon: Plug },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/admin/team', label: 'Team', icon: Users },
      { href: '/admin/branding', label: 'Branding', icon: Palette },
      { href: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const TITLES: Record<string, string> = {
  '/admin': 'Home',
  '/admin/analytics': 'Analytics',
  '/admin/agent-readiness': 'Agent Readiness',
  '/admin/tasks': 'Docs tasks',
  '/admin/mcp': 'MCP server',
  '/admin/team': 'Team',
  '/admin/branding': 'Branding',
  '/admin/settings': 'Settings',
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

// Stable no-op subscribe for the hydration-gate useSyncExternalStore below.
const emptySubscribe = () => () => {}

export function AdminShell({ siteName, children }: { siteName: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  // next-themes resolves the real theme only on the client, so gate any
  // theme-dependent render on hydration to keep SSR and first client render
  // identical. useSyncExternalStore returns the server snapshot (false) through
  // hydration, then the client snapshot (true) — no setState-in-effect.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  // The login screen renders bare — no shell chrome.
  if (pathname === '/admin/login') {
    return <div className="dox-dashboard">{children}</div>
  }

  async function handleLogout() {
    await fetch('/api/admin/auth', { method: 'DELETE' })
    router.replace('/admin/login')
  }

  // Until mounted, this is always false on both server and client (matching the
  // SSR default) so the toggle icon can't cause a hydration mismatch; it settles
  // to the real theme after mount.
  const isDark = mounted && resolvedTheme === 'dark'
  const title = TITLES[pathname] ?? 'Admin'

  return (
    <div className="dox-dashboard ds-shell">
      <AdminCommandMenu open={cmdOpen} onOpenChange={setCmdOpen} onLogout={() => void handleLogout()} />

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside className="ds-sidebar" data-collapsed={collapsed} data-open={mobileOpen}>
        <div className="ds-sidebar-head">
          {/* Top-aligned so the mark sits on the same line as the site name
              (the sub-label hangs below); collapsed mode still centers the
              lone mark via the sidebar's [data-collapsed] rules. */}
          <Link
            href="/admin"
            className="ds-workspace ds-focusable"
            style={{ alignItems: 'flex-start' }}
            onClick={() => setMobileOpen(false)}
          >
            <BrandMark size={20} />
            <span className="ds-rail-label min-w-0 truncate">
              <span className="ds-workspace-name block truncate" style={{ lineHeight: '20px' }}>{siteName}</span>
              <span className="ds-workspace-sub">Admin console</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="ds-iconbtn ds-focusable ds-mobile-only"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!collapsed ? (
          <div className="px-3">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="ds-sidebar-search ds-focusable"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search…</span>
              <kbd className="ds-kbd">⌘K</kbd>
            </button>
          </div>
        ) : null}

        <nav className="ds-nav">
          {NAV.map((group) => (
            <div key={group.label} className="ds-nav-group">
              <div className="ds-nav-group-label ds-rail-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className="ds-nav-item ds-focusable"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    <span className="ds-rail-label truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="ds-sidebar-foot">
          <div className="ds-sidebar-actions">
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="ds-nav-item ds-focusable"
              title={collapsed ? 'View site' : undefined}
            >
              <ExternalLink className="h-[18px] w-[18px]" />
              <span className="ds-rail-label truncate">View site</span>
            </a>
            <button
              type="button"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="ds-nav-item ds-focusable w-full"
              title={collapsed ? 'Toggle theme' : undefined}
            >
              {isDark ? <Sun className="h-[18px] w-[18px]" /> : <MoonStar className="h-[18px] w-[18px]" />}
              <span className="ds-rail-label truncate">{isDark ? 'Light theme' : 'Dark theme'}</span>
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="ds-nav-item ds-focusable ds-desktop-only w-full"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
              <span className="ds-rail-label truncate">Collapse</span>
            </button>
          </div>

          <div className="ds-account">
            <span className="ds-account-avatar">{siteName.charAt(0).toUpperCase()}</span>
            <span className="ds-rail-label min-w-0 flex-1 truncate">
              <span className="ds-account-name block truncate">Admin</span>
              <span className="ds-account-role">Signed in</span>
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="ds-iconbtn ds-focusable ds-rail-label"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="ds-content">
        <header className="ds-topbar">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="ds-iconbtn ds-focusable ds-mobile-only"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <nav className="flex items-center gap-2" aria-label="Breadcrumb">
            <span className="ds-crumb-muted">Admin</span>
            <span className="ds-crumb-sep">/</span>
            <span className="ds-crumb">{title}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="ds-iconbtn ds-focusable ds-mobile-only"
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </button>
            <a href="/" target="_blank" rel="noreferrer" className="ds-btn ds-btn--secondary ds-btn--sm ds-focusable">
              View site <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  )
}
