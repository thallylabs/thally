/**
 * Generic fallback disclaimer shown at the foot of the AI assistant panel.
 * Admins can override it from the dashboard (Settings → AI). Kept here so the
 * server (/api/chat-status) and the client widget (DocsChat) stay in sync.
 */
export const DEFAULT_AI_DISCLAIMER =
  'AI-generated answers may be inaccurate or incomplete. Verify important details against the documentation.'
