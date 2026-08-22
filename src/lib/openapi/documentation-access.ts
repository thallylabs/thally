/**
 * Resolves the access mode that applies to Thally's built-in documentation API.
 *
 * This deliberately uses the same local-password and managed-site inputs as
 * middleware so the published OpenAPI contract cannot drift from enforcement.
 */

import { isDocsAccessEnabledEdge } from '@/lib/admin/auth-edge'
import { getCloudAccessConfigEdge } from '@/lib/cloud-link/edge'

export type DocumentationApiAccessMode = 'public' | 'password'

/** Return the effective access mode for a request origin. */
export async function resolveDocumentationApiAccessMode(
  origin: string,
): Promise<DocumentationApiAccessMode> {
  const cloudAccess = await getCloudAccessConfigEdge(origin)
  return isDocsAccessEnabledEdge() || cloudAccess?.access?.mode === 'password'
    ? 'password'
    : 'public'
}
