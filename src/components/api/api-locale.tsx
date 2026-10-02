'use client'

import { createContext, useContext } from 'react'
import { apiLabel, type ApiLabelKey } from '@/lib/i18n/api-labels'

const ApiLocale = createContext<string | undefined>(undefined)

/** Gives the API panel and playground below it the page's locale for their labels. */
export const ApiLocaleProvider = ApiLocale.Provider

/** `t(key)` returns the label in the page's locale; outside a provider it is English. */
export function useApiLabels() {
  const locale = useContext(ApiLocale)
  return (key: ApiLabelKey, n?: number) => apiLabel(locale, key, n)
}
