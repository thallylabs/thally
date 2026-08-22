/**
 * Resolves the access mode that applies to Thally's built-in documentation API.
 *
 * This deliberately uses the same local-password and managed-site inputs as
 * middleware so the published OpenAPI contract cannot drift from enforcement.
 */

import { isDocsAccessEnabledEdge } from '@/lib/admin/auth-edge'
import { getCloudAccessConfigEdge } from '@/lib/cloud-link/edge'

export type DocumentationAccessMode = 'public' | 'password'

/** Return the effective access mode for a request origin. */
export async function resolveDocumentationAccessMode(
  origin: string,
): Promise<DocumentationAccessMode> {
  const cloudAccess = await getCloudAccessConfigEdge(origin)
  return isDocsAccessEnabledEdge() || cloudAccess?.access?.mode === 'password'
    ? 'password'
    : 'public'
}
