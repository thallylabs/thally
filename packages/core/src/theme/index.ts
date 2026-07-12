/**
 * Brand/theme token utilities — the `@thallylabs/core/theme` entry point.
 *
 * Deliberately split from the main entry: these helpers are pure (no Node
 * built-ins, no MDX/search deps) so they are safe to import from client
 * components (e.g. the admin branding panel) without dragging server-only code
 * into the browser bundle.
 */
export {
  hexToHslString,
  toHslValue,
  parseColorToHex,
  deriveDarkAccent,
} from './colors.js'
export { THEME_VARS, themeVarsFor } from './theme-vars.js'
