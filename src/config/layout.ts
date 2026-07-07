export const layout = {
  pagePadding: 'px-4 sm:px-6 lg:px-12',
  pageWidth: 'max-w-6xl',
  pageGap: 'space-y-12',
  contentGap: 'space-y-8',
  columnGap: 'gap-10 xl:gap-16',
  shellPadding: 'px-4 sm:px-6 lg:px-8',
  shellWidth: 'max-w-[100rem]',
  topbarHeight: 'h-16',
  sidebarWidth: 'w-[17.25rem] xl:w-[21.6rem]',
  sidebarPadding: 'px-5 py-8',
  sidebarGap: 'gap-8',
  tocWidth: 'w-64',
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
  sidebar: `${layout.sidebarWidth} border-r border-border/60 ${layout.sidebarPadding} ${layout.sidebarGap}`,
  main: `${layout.pagePadding} ${layout.pageGap}`,
  topbar: shellBounds,
}

