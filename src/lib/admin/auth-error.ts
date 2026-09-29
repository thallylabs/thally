/** Safe, status-specific authentication copy shared by password forms. */

/** Map response status without reflecting server bodies or internal details. */
export function getAuthErrorMessage(surface: 'admin' | 'docs', status: number): string {
  if (status === 401) {
    return surface === 'admin'
      ? 'That admin password did not work. Try again.'
      : 'That documentation password did not work. Try again.'
  }
  if (status === 429) {
    return 'Too many sign-in attempts. Wait a moment and try again.'
  }
  if (status >= 500) {
    return 'Sign-in is temporarily unavailable. Try again shortly.'
  }
  return 'Unable to sign in. Check your details and try again.'
}
