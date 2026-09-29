/** Portable reader appearance and safe browser-only background image resolution. */

export interface SiteAppearance {
  default?: 'system' | 'light' | 'dark'
  showToggle?: boolean
}

export interface SiteBackground {
  image?: string
  imageDark?: string
  decoration?: 'none' | 'grid' | 'gradient'
}

/** Resolve supported preferences per field so partial managed overrides stay portable. */
export function resolveSiteAppearance(repository?: SiteAppearance, managed?: SiteAppearance): Required<SiteAppearance> {
  const isMode = (value: unknown): value is NonNullable<SiteAppearance['default']> =>
    value === 'system' || value === 'light' || value === 'dark'
  return {
    default: isMode(managed?.default) ? managed.default : isMode(repository?.default) ? repository.default : 'system',
    showToggle: typeof managed?.showToggle === 'boolean' ? managed.showToggle : repository?.showToggle !== false,
  }
}

/** Accept public raster paths or HTTPS images; callers never fetch these on the server. */
export function resolveBackgroundImage(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f\\"'()<>]/.test(value)) return null
  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null
    } catch {
      return null
    }
  }
  if (!/^\/?[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(value) || value.includes('..') || value.includes('//')) return null
  return `/${value.replace(/^\//, '').replace(/^public\//, '')}`
}

/** Empty managed image strings intentionally clear an authored repository image. */
export function resolveSiteBackground(repository?: SiteBackground, managed?: SiteBackground): SiteBackground {
  const image = resolveBackgroundImage(managed?.image ?? repository?.image)
  const imageDark = resolveBackgroundImage(managed?.imageDark ?? repository?.imageDark)
  const decoration = managed?.decoration ?? repository?.decoration
  return {
    ...(image ? { image } : {}),
    ...(imageDark ? { imageDark } : {}),
    decoration: decoration === 'grid' || decoration === 'gradient' ? decoration : 'none',
  }
}

/** The locked system bootstrap runs before body content and ignores reader storage. */
export function lockedAppearanceScript(mode: Required<SiteAppearance>['default']): string {
  // Inline HTML scripts must contain only fixed code: JSON escaping cannot stop
  // a closing script tag if an untyped caller passes an unexpected mode.
  const selected = mode === 'dark' ? "'dark'" : mode === 'light' ? "'light'" : "(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')"
  return `(()=>{const d=document.documentElement,t=${selected};d.classList.remove('light','dark');d.classList.add(t);d.style.colorScheme=t})()`
}
