export const layout = {
  pagePadding: 'px-5 sm:px-8 lg:px-12',
  pageWidth: 'max-w-none',
  pageGap: 'space-y-10',
  contentGap: 'space-y-7',
  columnGap: 'gap-12',
  shellPadding: 'px-5 sm:px-[26px]',
  shellWidth: 'max-w-[1280px]',
  topbarHeight: 'h-[60px]',
  sidebarWidth: 'w-[232px]',
  sidebarPadding: 'pr-2 pt-9 pb-12',
  sidebarGap: 'gap-7',
  tocWidth: 'w-[196px]',
  stackGap: 'space-y-6',
  denseStackGap: 'space-y-4',
  panel: 'rounded-[var(--theme-radius-lg)] border border-border/60 bg-muted/30',
  panelMuted: 'rounded-[var(--theme-radius-lg)] border border-border/40 bg-muted/50',
}

export const typography = {
  heading: 'font-semibold tracking-tight text-foreground',
  body: 'text-base text-foreground/80 leading-relaxed',
  meta: 'text-xs font-semibold uppercase tracking-[0.3em] text-foreground/50',
}

const shellBounds = `mx-auto w-full ${layout.shellWidth} ${layout.shellPadding}`

export const shell = {
  wrapper: shellBounds,
  sidebar: `${layout.sidebarWidth} border-r border-border ${layout.sidebarPadding} ${layout.sidebarGap}`,
  main: `${layout.pagePadding} ${layout.pageGap}`,
  topbar: shellBounds,
}
