/**
 * An OpenAPI description is CommonMark. A page's meta description carries it as
 * one line of plain text, as Mintlify's does: links, images and emphasis keep
 * their words, code spans and backslash-escaped characters keep their text, tags
 * drop out, and line breaks become spaces.
 */
export function markdownLine(markdown: string): string {
  // Escapes and code spans are set aside so emphasis rules never read what they hold.
  const kept: Array<string> = []
  const keep = (text: string): string => `\u0000${kept.push(text) - 1}\u0000`
  return markdown
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_match, character: string) => keep(character))
    .replace(/(`+)([\s\S]+?)\1/g, (_match, _ticks: string, code: string) => keep(code))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '$1$2')
    .replace(/(^|\W)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => kept[Number(index)])
}
