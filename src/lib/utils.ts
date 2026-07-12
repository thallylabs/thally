import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}

/**
 * Slugify used by the MDX renderer to assign heading anchor ids.
 *
 * Kept here (rather than re-exported from `@thallylabs/core`) because this
 * module also exports `cn`, which client components import; pulling in core's
 * server-heavy main entry through `@/lib/utils` would drag Node/MDX/search code
 * into client bundles. This MUST stay byte-identical to
 * `@thallylabs/core`'s `slugify` (packages/core/src/slugify.ts) — the content
 * parser emits heading ids with that copy, and mismatched ids break in-page
 * anchor links.
 */
export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

