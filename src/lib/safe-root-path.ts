/**
 * Root-relative path check for authored links and sources.
 *
 * Browsers drop tab, LF and CR from anywhere in a URL, so `/\t/evil.com` would
 * resolve as `//evil.com`; every C0 control character and DEL is refused, not
 * only those three. A backslash is refused because browsers read it as `/`.
 */
const ROOT_PATH = /^\/(?!\/)[^\\\u0000-\u001f\u007f]*$/

/** True for a same-origin path such as `/docs/intro` that cannot be read as another origin. */
export function isSafeRootPath(value: string): boolean {
  return ROOT_PATH.test(value)
}
