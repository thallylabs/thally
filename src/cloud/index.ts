/**
 * Thally Cloud services stub — the open-source distribution of Thally ships no
 * cloud tier. Paid capabilities (Thally Track, AI answers, analytics) are
 * services provided by Thally Cloud and light up when a deployment carries
 * the real implementation of this module; every engine surface degrades
 * gracefully when it is absent (locked admin panels, hidden chat widget,
 * silent analytics no-op). See src/lib/cloud-bridge/types.ts for the
 * contract these services fulfil.
 */

import type { CloudServices } from '@/lib/cloud-bridge/types'

export const cloudServices: CloudServices | null = null
