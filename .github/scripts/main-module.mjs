/**
 * Decide whether a script module is the process entry point.
 *
 * Node loads the entry module from its real path, while `process.argv[1]`
 * keeps the path as it was typed. Comparing the two literally makes a script
 * invoked through a symlinked directory (for example `/tmp` on macOS) exit
 * successfully having done nothing, which for a CI planner or a release step
 * silently skips its work. Both sides are resolved to real paths instead.
 *
 * Imports only Node built-ins, so every script can use it from any checkout.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Return whether the module at `moduleUrl` (pass `import.meta.url`) is the
 * script Node was asked to run.
 *
 * @param {string} moduleUrl The calling module's `import.meta.url`.
 * @param {string | undefined} [entry] The entry path; defaults to `process.argv[1]`.
 * @returns {boolean}
 */
export function isMainModule(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    // An entry path that no longer resolves cannot be this module.
    return false;
  }
}
