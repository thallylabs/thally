/**
 * /login/jwt-callback#<jwt> — Mintlify-compatible JWT handoff landing page.
 *
 * The customer's app redirects here with the signed token in the URL
 * fragment, which browsers never send to servers, proxies, or Referer
 * headers. The client component below strips the fragment from history and
 * POSTs the token to `/api/reader/jwt`, which verifies it and sets the reader
 * session cookie. The path is reserved for this purpose on reader-auth sites.
 */

import type { Metadata } from 'next'
import { JwtCallback } from './jwt-callback'

export const metadata: Metadata = {
  title: 'Signing in…',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

/**
 * Runs while the HTML is parsed, before hydration and before any
 * `afterInteractive` analytics or custom script, so tools that record
 * `location.href` never see the token. Constant text: no request data.
 */
const CAPTURE_FRAGMENT = `(function(){try{var t=location.hash.slice(1);window.__thallyReaderHandoff=t;if(t){history.replaceState(null,'',location.pathname+location.search)}}catch(e){}})();`

export default function JwtCallbackPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CAPTURE_FRAGMENT }} />
      <JwtCallback />
    </>
  )
}
