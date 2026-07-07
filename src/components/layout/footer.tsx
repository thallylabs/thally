import Link from 'next/link'
import { siteConfig } from '@/data/site'
import type { DocsJsonFooter } from '@/data/docs'

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
}

export function Footer({ footerConfig }: FooterProps) {
  const hasSocials = footerConfig?.socials && Object.keys(footerConfig.socials).length > 0
  const hasColumns = footerConfig?.links && footerConfig.links.length > 0

  if (hasColumns || hasSocials) {
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
                            <Link href={item.href} className="text-sm text-foreground/60 hover:text-foreground">
                              {item.label}
                            </Link>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-3 text-sm text-foreground/60 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</p>
            {hasSocials && (
              <div className="flex items-center gap-3">
                {Object.entries(footerConfig!.socials!).map(([key, href]) => {
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
      <div className="flex flex-col gap-3 px-4 py-6 text-sm text-foreground/60 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</p>
        <div className="flex gap-4">
          {siteConfig.links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  )
}
