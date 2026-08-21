/**
 * Shared, side-effect-free payload builders for actions attached to rendered
 * code samples. Keeping these values independent from React makes their URL
 * and prompt contracts easy to protect with regression coverage.
 */

/** Build the assistant question shown after a reader selects a code sample. */
export function createCodeAssistantPrompt(code: string): string {
  return `Explain this code sample and check it for mistakes:\n\n\`\`\`\n${code}\n\`\`\``
}

/**
 * Build a safe GitHub-style issue URL for a code-sample report.
 *
 * A site owner may leave repository configuration blank or accidentally enter
 * a non-web URL. Returning null lets the UI disable reporting rather than
 * opening an arbitrary scheme from a documentation page.
 */
export function buildCodeReportUrl({
  repositoryUrl,
  pageUrl,
  code,
}: {
  repositoryUrl: string
  pageUrl: string
  code: string
}): string | null {
  try {
    const url = new URL(`${repositoryUrl.replace(/\/$/, '')}/issues/new`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.searchParams.set('title', 'Docs: incorrect code sample')
    url.searchParams.set(
      'body',
      `Page: ${pageUrl}\n\nCode sample:\n\n\`\`\`\n${code}\n\`\`\``,
    )
    return url.toString()
  } catch {
    return null
  }
}
