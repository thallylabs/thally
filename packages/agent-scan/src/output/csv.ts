/** RFC 4180 CSV writing and a minimal reader for input frames. */

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** Serialize rows; every row ends with CRLF as RFC 4180 specifies. */
export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map((cell) => quote(cell === null || cell === undefined ? '' : String(cell))).join(',')).join('\r\n') + '\r\n'
}

/** Parse CSV text into rows. Handles quoted fields, escaped quotes and CRLF or LF line ends. */
export function parseCsv(textInput: string): string[][] {
  const text = textInput.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
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
