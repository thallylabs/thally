/**
 * Locale configuration shared by repository config, live admin settings, and
 * Thally Cloud snapshots. The normalizer is deliberately fail-soft: malformed
 * live data can never take a documentation site down or erase its build-time
 * language configuration.
 */

export interface LocaleOption {
  code: string
  label: string
  name: string
}

export interface I18nLocale {
  code: string
  label: string
}

export interface I18nConfig {
  defaultLocale: string
  locales: Array<I18nLocale>
}

/**
 * Curated picker options cover the languages most documentation teams publish.
 * Repository-authored configs may still use any structurally valid BCP-47 tag.
 */
export const SUPPORTED_LOCALE_OPTIONS: ReadonlyArray<LocaleOption> = [
  { code: 'en', label: 'English', name: 'English' },
  { code: 'es', label: 'Español', name: 'Spanish' },
  { code: 'fr', label: 'Français', name: 'French' },
  { code: 'de', label: 'Deutsch', name: 'German' },
  { code: 'pt', label: 'Português', name: 'Portuguese' },
  { code: 'pt-BR', label: 'Português (Brasil)', name: 'Portuguese (Brazil)' },
  { code: 'it', label: 'Italiano', name: 'Italian' },
  { code: 'nl', label: 'Nederlands', name: 'Dutch' },
  { code: 'pl', label: 'Polski', name: 'Polish' },
  { code: 'cs', label: 'Čeština', name: 'Czech' },
  { code: 'ro', label: 'Română', name: 'Romanian' },
  { code: 'hu', label: 'Magyar', name: 'Hungarian' },
  { code: 'sv', label: 'Svenska', name: 'Swedish' },
  { code: 'da', label: 'Dansk', name: 'Danish' },
  { code: 'no', label: 'Norsk', name: 'Norwegian' },
  { code: 'fi', label: 'Suomi', name: 'Finnish' },
  { code: 'el', label: 'Ελληνικά', name: 'Greek' },
  { code: 'tr', label: 'Türkçe', name: 'Turkish' },
  { code: 'ru', label: 'Русский', name: 'Russian' },
  { code: 'uk', label: 'Українська', name: 'Ukrainian' },
  { code: 'ar', label: 'العربية', name: 'Arabic' },
  { code: 'he', label: 'עברית', name: 'Hebrew' },
  { code: 'fa', label: 'فارسی', name: 'Persian' },
  { code: 'ur', label: 'اردو', name: 'Urdu' },
  { code: 'hi', label: 'हिन्दी', name: 'Hindi' },
  { code: 'bn', label: 'বাংলা', name: 'Bengali' },
  { code: 'zh-Hans', label: '简体中文', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', label: '繁體中文', name: 'Chinese (Traditional)' },
  { code: 'ja', label: '日本語', name: 'Japanese' },
  { code: 'ko', label: '한국어', name: 'Korean' },
  { code: 'id', label: 'Bahasa Indonesia', name: 'Indonesian' },
  { code: 'ms', label: 'Bahasa Melayu', name: 'Malay' },
  { code: 'th', label: 'ไทย', name: 'Thai' },
  { code: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
] as const

export const DEFAULT_I18N_CONFIG: I18nConfig = {
  defaultLocale: 'en',
  locales: [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Español' },
  ],
}

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ps', 'ur'])

function canonicalLocaleCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 35) return null
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null
  } catch {
    return null
  }
}

function safeLabel(value: unknown, code: string): string {
  if (typeof value !== 'string') return code
  const label = value.trim().slice(0, 80)
  return label || code
}

/**
 * Validate an untrusted locale config while retaining a known-good fallback.
 * Locale count is bounded because each locale multiplies routes and metadata.
 */
export function normalizeI18nConfig(
  value: unknown,
  fallback: I18nConfig = DEFAULT_I18N_CONFIG,
): I18nConfig {
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as { defaultLocale?: unknown; locales?: unknown }
  if (!Array.isArray(candidate.locales)) return fallback

  const locales: Array<I18nLocale> = []
  const seen = new Set<string>()
  for (const item of candidate.locales.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const record = item as { code?: unknown; label?: unknown }
    const code = canonicalLocaleCode(record.code)
    if (!code) continue
    const key = code.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    locales.push({ code, label: safeLabel(record.label, code) })
  }
  if (locales.length === 0) return fallback

  const requestedDefault = canonicalLocaleCode(candidate.defaultLocale)
  const fallbackDefault = canonicalLocaleCode(fallback.defaultLocale)
  const defaultLocale =
    locales.find((locale) => locale.code.toLowerCase() === requestedDefault?.toLowerCase())?.code ??
    locales.find((locale) => locale.code.toLowerCase() === fallbackDefault?.toLowerCase())?.code ??
    locales[0].code

  return { defaultLocale, locales }
}

/**
 * Apply a live language selection without changing the repository's source
 * language. The root content tree is authored in that language; pinning it as
 * default keeps `<html lang>` and unprefixed crawler content truthful while
 * locale directories can progressively add server-rendered translations.
 */
export function resolveI18nSelection(
  value: unknown,
  repository: I18nConfig,
): I18nConfig {
  const normalized = normalizeI18nConfig(value, repository)
  const sourceDefault =
    repository.locales.find(
      (locale) =>
        locale.code.toLowerCase() === repository.defaultLocale.toLowerCase(),
    ) ?? {
      code: repository.defaultLocale,
      label: repository.defaultLocale,
    }
  const locales = [
    sourceDefault,
    ...normalized.locales.filter(
      (locale) => locale.code.toLowerCase() !== sourceDefault.code.toLowerCase(),
    ),
  ].slice(0, 20)

  return {
    defaultLocale: sourceDefault.code,
    locales,
  }
}

/**
 * Strictly validate an admin/API selection. Unlike the fail-soft request-time
 * normalizer, this rejects truncated, malformed, duplicate, or unknown values
 * so persisted configuration always reflects exactly what the owner chose.
 */
export function validateI18nSelection(
  value: unknown,
  repository: I18nConfig,
): I18nConfig | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { locales?: unknown }
  if (
    !Array.isArray(candidate.locales) ||
    candidate.locales.length === 0 ||
    candidate.locales.length > 20
  ) {
    return null
  }

  const normalized = normalizeI18nConfig(value, {
    defaultLocale: '',
    locales: [],
  })
  if (normalized.locales.length !== candidate.locales.length) return null

  const allowedLocales = new Map(
    [...SUPPORTED_LOCALE_OPTIONS, ...repository.locales].map((locale) => [
      locale.code.toLowerCase(),
      { code: locale.code, label: locale.label },
    ]),
  )
  if (
    normalized.locales.some(
      (locale) => !allowedLocales.has(locale.code.toLowerCase()),
    )
  ) {
    return null
  }

  return resolveI18nSelection(
    {
      defaultLocale: normalized.defaultLocale,
      locales: normalized.locales.map(
        (locale) =>
          allowedLocales.get(locale.code.toLowerCase()) ?? locale,
      ),
    },
    repository,
  )
}

/** Text direction for the locale's base language. */
export function localeDirection(code: string): 'ltr' | 'rtl' {
  const canonical = canonicalLocaleCode(code) ?? code
  return RTL_LANGUAGES.has(canonical.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr'
}

/** Map one locale to its canonical URL for a locale-independent page path. */
export function localizedPath(path: string, locale: string, defaultLocale: string): string {
  const normalizedPath = path === '/' ? '/' : `/${path.replace(/^\/+|\/+$/g, '')}`
  return locale === defaultLocale
    ? normalizedPath
    : normalizedPath === '/'
      ? `/${locale}`
      : `/${locale}${normalizedPath}`
}
