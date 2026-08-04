/**
 * Request-time locale resolution. Cloud-managed settings take precedence over
 * self-hosted admin overrides, which take precedence over docs.json. Every
 * source is normalized before it reaches routing or crawler-facing metadata.
 */

import 'server-only'

import { cache } from 'react'
import { getI18nConfig } from '@/data/docs'
import { getAdminSettings } from '@/lib/admin/settings'
import { getRequestCloudSiteConfig } from '@/lib/cloud-link/request'
import { getManagedSiteConfigSnapshot } from '@/lib/cloud-link/client'
import {
  DEFAULT_I18N_CONFIG,
  normalizeI18nConfig,
  resolveI18nSelection,
  type I18nConfig,
} from './config'

/** Build-time locale config, normalized with the English/Spanish starter. */
export function getRepositoryI18nConfig(): I18nConfig {
  return normalizeI18nConfig(getI18nConfig(), DEFAULT_I18N_CONFIG)
}

/** Locale selection safe to embed in an immutable documentation release. */
export function getBuildI18nConfig(): I18nConfig {
  const repository = getRepositoryI18nConfig()
  const localization =
    getManagedSiteConfigSnapshot()?.siteConfig.portable.localization
  return localization
    ? resolveI18nSelection(localization, repository)
    : repository
}

/**
 * Effective config for the current request. React cache prevents the root
 * layout, docs shell, metadata, and page body from repeating remote/storage
 * reads during one render.
 */
export const getEffectiveI18nConfig = cache(async (): Promise<I18nConfig> => {
  const repository = getRepositoryI18nConfig()
  const cloud = await getRequestCloudSiteConfig()
  if (cloud?.siteConfig.portable.localization) {
    return resolveI18nSelection(
      cloud.siteConfig.portable.localization,
      repository,
    )
  }

  const admin = await getAdminSettings()
  return resolveI18nSelection(admin.localization, repository)
})
