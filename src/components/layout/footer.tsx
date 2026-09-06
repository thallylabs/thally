/** Shared footer; the server resolves attribution policy before client hydration. */

import type { SiteLink } from '@/data/site'
import type { DocsJsonFooter } from '@/data/docs'
import { IntentPrefetchLink } from '@/components/navigation/intent-prefetch-link'

// Social icon SVGs (inline, no extra dep needed)
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  )
}

function TwitterXIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

const SOCIAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  github: GithubIcon,
  twitter: TwitterXIcon,
  x: TwitterXIcon,
  discord: DiscordIcon,
  linkedin: LinkedInIcon,
}

interface FooterProps {
  footerConfig?: DocsJsonFooter | null
  siteName: string
  siteLinks: Array<SiteLink>
  showPoweredBy?: boolean
  /** Legacy navbar GitHub links move here so upgrades preserve the destination. */
  githubHref?: string
}

/** Render the quiet attribution in the copyright row only when authorized. */
function PoweredByThally() {
  return (
    <a
      href="https://thally.io?utm_source=powered-by&utm_medium=docs-footer"
      rel="noopener"
      aria-label="Powered by Thally"
      className="inline-flex items-center gap-[7px] whitespace-nowrap text-[0.82rem] text-[color:var(--faint,hsl(var(--thally-muted-foreground)/0.8))] transition-colors hover:text-foreground sm:border-l sm:border-border sm:pl-6"
    >
      <svg viewBox="0 0 32 32" width="12" height="12" className="shrink-0 text-[#737938]" aria-hidden="true">
        <path fill="currentColor" d="M30.72 2.27L30.77 2.47L30.80 2.68L30.80 2.91L30.77 3.15L30.72 3.40L30.69 3.65L30.66 3.90L30.65 4.15L30.65 4.40L30.64 4.65L30.61 4.90L30.57 5.15L30.52 5.40L30.47 5.65L30.42 5.90L30.37 6.15L30.32 6.40L30.27 6.65L30.22 6.90L30.17 7.15L30.12 7.40L30.07 7.65L30.02 7.91L29.97 8.16L29.92 8.41L29.87 8.66L29.82 8.91L29.77 9.16L29.72 9.41L29.67 9.66L29.62 9.91L29.57 10.16L29.52 10.41L29.46 10.66L29.39 10.91L29.30 11.16L29.20 11.41L29.11 11.66L29.03 11.91L28.97 12.16L28.92 12.41L28.86 12.66L28.78 12.91L28.70 13.16L28.60 13.41L28.50 13.66L28.40 13.92L28.30 14.17L28.20 14.42L28.10 14.67L28.00 14.92L27.90 15.17L27.79 15.42L27.69 15.67L27.59 15.92L27.49 16.17L27.39 16.42L27.28 16.67L27.16 16.92L27.02 17.17L26.87 17.42L26.72 17.67L26.57 17.92L26.42 18.17L26.27 18.42L26.12 18.67L25.97 18.92L25.82 19.17L25.67 19.42L25.52 19.67L25.37 19.93L25.22 20.18L25.07 20.43L24.90 20.68L24.73 20.93L24.54 21.18L24.34 21.43L24.13 21.68L23.90 21.93L23.66 22.18L23.41 22.43L23.16 22.68L22.91 22.93L22.66 23.18L22.41 23.43L22.16 23.66L21.91 23.86L21.66 24.03L21.41 24.18L21.16 24.33L20.91 24.48L20.66 24.63L20.41 24.78L20.16 24.93L19.91 25.08L19.66 25.23L19.41 25.38L19.16 25.52L18.90 25.65L18.65 25.76L18.40 25.86L18.15 25.95L17.90 26.02L17.65 26.09L17.40 26.14L17.15 26.19L16.90 26.24L16.65 26.29L16.40 26.34L16.15 26.37L15.90 26.40L15.65 26.41L15.40 26.41L15.15 26.41L14.90 26.41L14.65 26.41L14.40 26.41L14.15 26.41L13.90 26.41L13.65 26.41L13.40 26.41L13.15 26.40L12.89 26.37L12.64 26.34L12.39 26.29L12.14 26.24L11.89 26.19L11.64 26.14L11.39 26.09L11.14 26.04L10.89 25.99L10.64 25.94L10.39 25.89L10.14 25.82L9.89 25.75L9.64 25.66L9.39 25.56L9.14 25.46L8.89 25.36L8.64 25.26L8.39 25.16L8.14 25.05L7.89 24.92L7.64 24.78L7.39 24.63L7.14 24.52L6.88 24.45L6.63 24.41L6.38 24.41L6.13 24.47L5.88 24.60L5.63 24.78L5.38 25.03L5.16 25.28L4.96 25.53L4.78 25.79L4.63 26.04L4.49 26.29L4.37 26.54L4.26 26.79L4.15 27.04L4.04 27.29L3.92 27.54L3.78 27.79L3.63 28.04L3.50 28.29L3.40 28.54L3.33 28.79L3.28 29.04L3.18 29.27L3.03 29.47L2.83 29.64L2.58 29.79L2.33 29.88L2.08 29.90L1.83 29.87L1.58 29.77L1.39 29.63L1.26 29.45L1.20 29.24L1.20 28.99L1.23 28.74L1.28 28.49L1.35 28.24L1.45 27.99L1.56 27.74L1.69 27.49L1.83 27.24L1.98 26.99L2.13 26.74L2.28 26.49L2.43 26.24L2.58 25.99L2.73 25.74L2.88 25.48L3.03 25.23L3.18 24.98L3.34 24.73L3.52 24.48L3.70 24.23L3.90 23.98L4.12 23.73L4.34 23.48L4.58 23.23L4.83 22.98L5.08 22.74L5.33 22.52L5.58 22.30L5.83 22.10L6.08 21.92L6.33 21.74L6.58 21.58L6.83 21.43L7.08 21.28L7.34 21.13L7.59 20.98L7.84 20.83L8.09 20.69L8.34 20.56L8.59 20.45L8.84 20.35L9.09 20.26L9.34 20.19L9.59 20.13L9.84 20.08L10.09 20.03L10.34 19.98L10.59 19.93L10.84 19.88L11.09 19.83L11.34 19.78L11.59 19.73L11.84 19.67L12.09 19.64L12.34 19.61L12.59 19.60L12.84 19.60L13.10 19.59L13.35 19.56L13.60 19.52L13.85 19.47L14.10 19.41L14.35 19.34L14.60 19.25L14.85 19.15L15.10 19.06L15.35 18.99L15.60 18.92L15.85 18.87L16.10 18.81L16.35 18.74L16.60 18.65L16.85 18.55L17.10 18.44L17.35 18.31L17.60 18.17L17.85 18.02L18.10 17.86L18.35 17.68L18.60 17.50L18.85 17.30L19.11 17.10L19.36 16.90L19.61 16.69L19.86 16.49L20.11 16.29L20.36 16.09L20.61 15.89L20.86 15.69L21.10 15.48L21.32 15.25L21.53 15.02L21.73 14.77L21.94 14.52L22.14 14.27L22.34 14.02L22.54 13.76L22.74 13.51L22.94 13.26L23.14 13.01L23.34 12.76L23.53 12.51L23.70 12.26L23.86 12.01L24.01 11.76L24.09 11.57L24.09 11.45L24.01 11.39L23.86 11.39L23.70 11.45L23.53 11.57L23.34 11.76L23.14 12.01L22.92 12.25L22.70 12.48L22.46 12.69L22.21 12.89L21.96 13.09L21.71 13.29L21.46 13.49L21.21 13.69L20.96 13.89L20.71 14.09L20.46 14.29L20.21 14.49L19.96 14.68L19.71 14.85L19.46 15.02L19.21 15.17L18.95 15.31L18.70 15.43L18.45 15.54L18.20 15.64L17.95 15.76L17.70 15.88L17.45 16.02L17.20 16.17L16.95 16.31L16.70 16.43L16.45 16.54L16.20 16.64L15.95 16.73L15.70 16.81L15.45 16.87L15.20 16.92L14.95 16.97L14.70 17.02L14.45 17.07L14.20 17.12L13.95 17.17L13.70 17.22L13.45 17.27L13.20 17.32L12.94 17.37L12.69 17.42L12.44 17.47L12.19 17.52L11.94 17.57L11.69 17.62L11.44 17.67L11.19 17.72L10.94 17.77L10.69 17.82L10.44 17.87L10.19 17.92L9.94 17.97L9.69 18.02L9.44 18.07L9.19 18.12L8.94 18.20L8.69 18.30L8.44 18.42L8.19 18.57L7.94 18.71L7.69 18.84L7.44 18.95L7.19 19.05L6.93 19.17L6.68 19.32L6.43 19.50L6.18 19.70L5.93 19.90L5.68 20.10L5.43 20.30L5.18 20.50L4.97 20.64L4.79 20.71L4.66 20.73L4.56 20.68L4.47 20.58L4.39 20.43L4.33 20.23L4.28 19.98L4.24 19.73L4.22 19.47L4.21 19.22L4.21 18.97L4.22 18.72L4.24 18.47L4.28 18.22L4.33 17.97L4.37 17.72L4.39 17.47L4.41 17.22L4.41 16.97L4.42 16.72L4.44 16.47L4.48 16.22L4.53 15.97L4.59 15.72L4.67 15.47L4.76 15.22L4.86 14.97L4.94 14.72L5.02 14.47L5.08 14.22L5.13 13.97L5.21 13.71L5.31 13.46L5.43 13.21L5.58 12.96L5.72 12.71L5.85 12.46L5.96 12.21L6.06 11.96L6.18 11.71L6.33 11.46L6.51 11.21L6.71 10.96L6.92 10.71L7.15 10.46L7.39 10.21L7.64 9.96L7.89 9.72L8.14 9.50L8.39 9.28L8.64 9.08L8.89 8.89L9.14 8.72L9.39 8.56L9.64 8.41L9.89 8.26L10.14 8.11L10.39 7.96L10.64 7.80L10.89 7.67L11.14 7.54L11.39 7.43L11.64 7.33L11.89 7.24L12.14 7.17L12.39 7.10L12.64 7.05L12.89 6.99L13.15 6.92L13.40 6.83L13.65 6.73L13.90 6.65L14.15 6.60L14.40 6.58L14.65 6.58L14.90 6.57L15.15 6.54L15.40 6.50L15.65 6.45L15.90 6.40L16.15 6.35L16.40 6.30L16.65 6.25L16.90 6.20L17.15 6.15L17.40 6.10L17.65 6.05L17.90 6.01L18.15 5.99L18.40 5.98L18.65 5.98L18.90 5.98L19.16 5.98L19.41 5.98L19.66 5.98L19.91 5.96L20.16 5.94L20.41 5.90L20.66 5.85L20.91 5.80L21.16 5.75L21.41 5.70L21.66 5.65L21.91 5.60L22.16 5.55L22.41 5.50L22.66 5.45L22.91 5.40L23.16 5.35L23.41 5.30L23.66 5.25L23.91 5.20L24.16 5.15L24.41 5.10L24.66 5.05L24.92 4.99L25.17 4.91L25.42 4.82L25.67 4.72L25.92 4.62L26.17 4.52L26.42 4.42L26.67 4.32L26.92 4.22L27.17 4.12L27.42 4.02L27.67 3.92L27.92 3.81L28.17 3.69L28.42 3.55L28.67 3.40L28.92 3.23L29.17 3.06L29.42 2.87L29.67 2.67L29.90 2.50L30.10 2.35L30.27 2.22L30.42 2.12L30.55 2.10L30.65 2.15Z" />
      </svg>
      <span>Powered by <b className="font-semibold">Thally</b></span>
    </a>
  )
}

/** Render configured and default footers with the same server-decided policy. */
export function Footer({ footerConfig, siteName, siteLinks, showPoweredBy = true, githubHref }: FooterProps) {
  const socials: Record<string, string> = {
    ...footerConfig?.socials,
    ...(githubHref && !footerConfig?.socials?.github ? { github: githubHref } : {}),
  }
  const hasSocials = Object.keys(socials).length > 0
  const hasConfiguredSocials = Boolean(
    footerConfig?.socials && Object.keys(footerConfig.socials).length > 0,
  )
  const hasColumns = footerConfig?.links && footerConfig.links.length > 0

  if (hasColumns || hasConfiguredSocials) {
    return (
      <footer className="border-t border-border/60 bg-muted/30">
        <div className="px-4 py-8 sm:px-6 lg:px-8">
          {hasColumns && (
            <div className="mb-8 grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
              {footerConfig!.links!.map((col) => (
                <div key={col.heading}>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground/50">
                    {col.heading}
                  </h3>
                  <ul className="space-y-2">
                    {col.items.map((item) => {
                      const isExternal = /^https?:\/\//.test(item.href)
                      return (
                        <li key={item.href}>
                          {isExternal ? (
                            <a
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-foreground/60 hover:text-foreground"
                            >
                              {item.label}
                            </a>
                          ) : (
                            <IntentPrefetchLink href={item.href} className="text-sm text-foreground/60 hover:text-foreground">
                              {item.label}
                            </IntentPrefetchLink>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} {siteName}. All rights reserved.</p>
            {showPoweredBy && <PoweredByThally />}
            {hasSocials && (
              <div className="ml-auto flex items-center gap-4">
                {Object.entries(socials).map(([key, href]) => {
                  const Icon = SOCIAL_ICONS[key.toLowerCase()]
                  return (
                    <a
                      key={key}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-foreground"
                      aria-label={key}
                    >
                      {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs capitalize">{key}</span>}
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </footer>
    )
  }

  // Default footer (no footerConfig)
  return (
    <footer className="border-t border-border/60 bg-muted/30">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} {siteName}. All rights reserved.</p>
        {showPoweredBy && <PoweredByThally />}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          {siteLinks.map((link) => (
            <IntentPrefetchLink key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </IntentPrefetchLink>
          ))}
          {hasSocials
            ? Object.entries(socials).map(([key, href]) => {
                const Icon = SOCIAL_ICONS[key.toLowerCase()]
                return (
                  <a
                    key={key}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground"
                    aria-label={key}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs capitalize">{key}</span>}
                  </a>
                )
              })
            : null}
        </div>
      </div>
    </footer>
  )
}
