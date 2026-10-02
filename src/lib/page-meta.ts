/** Page title and social metadata, following Mintlify's rules for migrated sites. */

interface PageTitleInput {
  title: string
  /** `og:title` frontmatter: used verbatim as the full page title. */
  ogTitle?: string
  siteName: string
  /** docs.json `seo.titleSeparator`; without it the layout's `title | site` template applies. */
  separator?: string
}

/**
 * The complete page title, or undefined when the layout template should add the
 * site name. Mintlify shows `og:title` as-is, else `<title><separator><site>`.
 */
export function pageFullTitle({ title, ogTitle, siteName, separator }: PageTitleInput): string | undefined {
  if (ogTitle) return ogTitle
  return separator ? `${title}${separator}${siteName}` : undefined
}
