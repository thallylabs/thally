/**
 * Resolves the access mode that applies to Thally's built-in documentation API.
 *
 * This deliberately uses the same local-password and managed-site inputs as
 * middleware so the published OpenAPI contract cannot drift from enforcement.
 */

import { isDocsAccessEnabledEdge } from '@/lib/admin/auth-edge'
import {
  getCloudAccessConfigEdge,
  isCloudAccessConfiguredEdge,
} from '@/lib/cloud-link/edge'

export type DocumentationAccessMode = 'public' | 'password'

/** Return the effective access mode for a request origin. */
export async function resolveDocumentationAccessMode(
  origin: string,
): Promise<DocumentationAccessMode> {
  if (isDocsAccessEnabledEdge()) return 'password'

  const cloudAccess = await getCloudAccessConfigEdge(origin)
  if (cloudAccess?.access?.mode === 'public') return 'public'
  if (cloudAccess?.access?.mode === 'password') return 'password'

  // A missing grant is only evidence of public access for a self-hosted site.
  // Managed runtimes fail closed so a transient Cloud lookup failure cannot
  // publish and cache an anonymous contract for password-protected docs.
  return isCloudAccessConfiguredEdge() ? 'password' : 'public'
}
