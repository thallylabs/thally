/**
 * Accepts a single CSS colour (hex, keyword or a colour function) and nothing
 * else, so a configured value can never add declarations to an inline style.
 */
const COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|[a-z]{3,30}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9a-z\s.,%/+-]{1,80}\))$/i

export function safeCssColor(value: unknown): string | undefined {
  return typeof value === 'string' && COLOR_PATTERN.test(value.trim()) ? value.trim() : undefined
}
