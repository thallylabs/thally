/**
 * Structural-theme CSS variable overrides. Shared by the root layout (SSR
 * default) and /api/brand.css (the live admin override), so both stay in sync.
 */
export const THEME_VARS: Record<string, string> = {
  default: '',
  maple: [
    '--theme-radius-sm:0.5rem',
    '--theme-radius-md:0.75rem',
    '--theme-radius-lg:1.25rem',
    '--theme-radius-xl:2rem',
    '--theme-sidebar-item-radius:0.625rem',
    '--theme-sidebar-indicator-opacity:0',
    '--theme-nav-bar-radius:1.5rem',
    '--theme-nav-tab-radius:9999px',
    '--theme-nav-tab-indicator-opacity:0',
  ].join(';'),
  sharp: [
    '--theme-radius-sm:0.125rem',
    '--theme-radius-md:0.1875rem',
    '--theme-radius-lg:0.25rem',
    '--theme-radius-xl:0.375rem',
    '--theme-control-radius:0.1875rem',
    '--theme-badge-radius:0.1875rem',
    '--theme-sidebar-item-radius:0.1875rem',
    '--theme-sidebar-indicator-opacity:1',
    '--sidebar-active-bg:0 0% 0% / 0',
    '--theme-nav-bar-bg:transparent',
    '--theme-nav-bar-border-color:transparent',
    '--theme-nav-bar-radius:0.25rem',
    '--theme-nav-tab-radius:0.25rem',
    '--theme-nav-tab-indicator-opacity:1',
  ].join(';'),
  minimal: [
    '--theme-radius-sm:0',
    '--theme-radius-md:0',
    '--theme-radius-lg:0',
    '--theme-radius-xl:0',
    '--theme-control-radius:0',
    '--theme-badge-radius:0',
    '--theme-sidebar-item-radius:0',
    '--theme-sidebar-indicator-opacity:0',
    '--sidebar-active-bg:0 0% 0% / 0',
    '--theme-nav-bar-bg:transparent',
    '--theme-nav-bar-border-color:transparent',
    '--theme-nav-tab-active-bg:transparent',
    '--theme-nav-tab-active-shadow:none',
    '--theme-nav-bar-radius:0',
    '--theme-nav-tab-radius:0',
    '--theme-nav-tab-indicator-opacity:1',
  ].join(';'),
}

export function themeVarsFor(theme: string | null | undefined): string {
  return (theme && THEME_VARS[theme]) || ''
}
