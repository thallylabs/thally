import { LocalizedSidebarHydrator } from '@/components/layout/localized-sidebar-hydrator'
import { getBuildI18nConfig } from '@/lib/i18n/request'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params

  // Guard: if this is not a valid secondary locale (e.g. /quickstart was intercepted as
  // locale="quickstart"), skip locale-aware sidebar hydration to avoid invalid hrefs.
  const i18n = getBuildI18nConfig()
  const isValid = i18n.locales.some((l) => l.code === locale && l.code !== i18n.defaultLocale)
  if (!isValid) return <>{children}</>

  return (
    <>
      <LocalizedSidebarHydrator locale={locale} />
      {children}
    </>
  )
}
