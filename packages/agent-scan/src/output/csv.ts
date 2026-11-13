/** RFC 4180 CSV writing and a minimal reader for input frames. */

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** Serialize rows; every row ends with CRLF as RFC 4180 specifies. */
export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map((cell) => quote(cell === null || cell === undefined ? '' : String(cell))).join(',')).join('\r\n') + '\r\n'
}

/** Malformed CSV input, with the 1-based line where the problem starts. */
export class CsvError extends Error {
  constructor(message: string, readonly line: number) {
    super(message)
    this.name = 'CsvError'
  }
}

/**
 * Parse CSV text into rows. Handles quoted fields, escaped quotes and CRLF or
 * LF line ends. Throws `CsvError` for a quote that is never closed, rather
 * than silently swallowing the rest of the file.
 */
export function parseCsv(textInput: string): string[][] {
  const text = textInput.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let quoteLine = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      // A line end inside a quoted field: count LF, and a CR not followed by LF.
      if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
      quoteLine = line
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      line++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (inQuotes) throw new CsvError(`unterminated quoted field starting on line ${quoteLine}`, quoteLine)
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

/** Parse CSV with a header row into records keyed by header name. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const names = header.map((name) => name.trim())
  return rows.map((row) => Object.fromEntries(names.map((name, i) => [name, (row[i] ?? '').trim()])))
}
