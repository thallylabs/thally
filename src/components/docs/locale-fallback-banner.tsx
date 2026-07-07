interface LocaleFallbackBannerProps {
  locale: string
  defaultLocale: string
}

export function LocaleFallbackBanner({ locale, defaultLocale }: LocaleFallbackBannerProps) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
      <span className="mt-0.5 shrink-0 text-base leading-none">⚠️</span>
      <p>
        This page hasn&apos;t been translated to <strong>{locale}</strong> yet. Showing the original{' '}
        <strong>{defaultLocale.toUpperCase()}</strong> version.
      </p>
    </div>
  )
}
