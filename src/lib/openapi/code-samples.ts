/**
 * Request samples in the seven languages the live docs offer, all built from
 * one request model. Hand-written on purpose: a snippet library would add
 * far more to the Worker than these few templates.
 */

export interface SampleRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  /** A multipart body as `name=value` fields (files as `@name`); only the cURL sample can show it. */
  form?: Array<[string, string]>
}

export interface CodeSample {
  label: string
  source: string
}

export const SAMPLE_LANGUAGES = ['cURL', 'Python', 'JavaScript', 'PHP', 'Go', 'Java', 'Ruby'] as const

const q = (value: string) => JSON.stringify(value)

export function buildCurlCommand(method: string, url: string, headers: Record<string, string>, body?: string, form?: Array<[string, string]>) {
  if (!url) {
    return []
  }
  const parts = [
    `--url ${/[\s&?'"$`\\]/.test(url) ? `'${url.replace(/'/g, `'"'"'`)}'` : url}`,
    ...Object.entries(headers)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => `--header '${`${key}: ${value}`.replace(/'/g, `'"'"'`)}'`),
  ]
  if (body) {
    parts.push(`--data '${body.replace(/'/g, `'"'"'`)}'`)
  }
  for (const [name, value] of form ?? []) {
    parts.push(`--form '${`${name}=${value}`.replace(/'/g, `'"'"'`)}'`)
  }
  return [`curl --request ${method.toUpperCase()}`, ...parts].map((line, index, all) => `${index ? '  ' : ''}${line}${index < all.length - 1 ? ' \\' : ''}`)
}

function parseJson(body: string): unknown {
  try {
    const value: unknown = JSON.parse(body)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

function python(value: unknown, depth = 0): string {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value !== 'object') return JSON.stringify(value)
  const pad = '    '.repeat(depth + 1)
  const end = '    '.repeat(depth)
  const items = Array.isArray(value)
    ? value.map((item) => `${pad}${python(item, depth + 1)}`)
    : Object.entries(value).map(([key, item]) => `${pad}${q(key)}: ${python(item, depth + 1)}`)
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return items.length ? `${open}\n${items.join(',\n')}\n${end}${close}` : `${open}${close}`
}

const pythonSample = ({ method, url, headers, body }: SampleRequest) => {
  const json = body ? parseJson(body) : undefined
  const lines = ['import requests', '', `url = ${q(url)}`, '']
  if (body) lines.push(json ? `payload = ${python(json)}` : `payload = ${q(body)}`)
  const headerLines = Object.entries(headers).map(([key, value]) => `    ${q(key)}: ${q(value)}`)
  // One header stays on one line, as on live.
  if (headerLines.length === 1) lines.push(`headers = {${headerLines[0].trim()}}`)
  else if (headerLines.length) lines.push(`headers = {\n${headerLines.join(',\n')}\n}`)
  lines.push('')
  const args = ['url', ...(body ? [json ? 'json=payload' : 'data=payload'] : []), ...(headerLines.length ? ['headers=headers'] : [])]
  lines.push(`response = requests.${method.toLowerCase()}(${args.join(', ')})`, '', 'print(response.text)')
  return lines.join('\n')
}

const javascriptSample = ({ method, url, headers, body }: SampleRequest) => {
  const json = body ? parseJson(body) : undefined
  const bodyArg = !body ? '' : json ? `JSON.stringify(${JSON.stringify(json, null, 2).replace(/\n/g, '\n  ')})` : q(body)
  const options = [`  method: ${q(method.toUpperCase())}`, `  headers: ${JSON.stringify(headers)}`, ...(bodyArg ? [`  body: ${bodyArg}`] : [])]
  return [
    `const options = {\n${options.join(',\n')}\n};`,
    '',
    `fetch(${q(url)}, options)`,
    '  .then(res => res.json())',
    '  .then(res => console.log(res))',
    '  .catch(err => console.error(err));',
  ].join('\n')
}

const phpString = (value: string) => q(value).replace(/\$/g, '\\$')

const phpSample = ({ method, url, headers, body }: SampleRequest) => {
  const json = body ? parseJson(body) : undefined
  const headerLines = Object.entries(headers).map(([key, value]) => `    ${phpString(`${key}: ${value}`)}`)
  return [
    '<?php',
    '',
    '$curl = curl_init();',
    '',
    'curl_setopt_array($curl, [',
    `  CURLOPT_URL => ${phpString(url)},`,
    '  CURLOPT_RETURNTRANSFER => true,',
    '  CURLOPT_ENCODING => "",',
    '  CURLOPT_MAXREDIRS => 10,',
    '  CURLOPT_TIMEOUT => 30,',
    '  CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,',
    `  CURLOPT_CUSTOMREQUEST => ${phpString(method.toUpperCase())},`,
    ...(body ? [`  CURLOPT_POSTFIELDS => ${phpString(json ? JSON.stringify(json, null, 2) : body)},`] : []),
    ...(headerLines.length ? [`  CURLOPT_HTTPHEADER => [\n${headerLines.join(',\n')}\n  ],`] : []),
    ']);',
    '',
    '$response = curl_exec($curl);',
    '$err = curl_error($curl);',
    '',
    'curl_close($curl);',
    '',
    'if ($err) {',
    '  echo "cURL Error #:" . $err;',
    '} else {',
    '  echo $response;',
    '}',
  ].join('\n')
}

const prettyBody = (body: string) => {
  const json = parseJson(body)
  return json ? JSON.stringify(json, null, 2) : body
}

const goSample = ({ method, url, headers, body }: SampleRequest) =>
  [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    ...(body ? ['\t"strings"'] : []),
    '\t"net/http"',
    '\t"io"',
    ')',
    '',
    'func main() {',
    '',
    `\turl := ${q(url)}`,
    '',
    ...(body ? [`\tpayload := strings.NewReader(${q(prettyBody(body))})`, ''] : []),
    `\treq, _ := http.NewRequest(${q(method.toUpperCase())}, url, ${body ? 'payload' : 'nil'})`,
    '',
    ...Object.entries(headers).map(([key, value]) => `\treq.Header.Add(${q(key)}, ${q(value)})`),
    ...(Object.keys(headers).length ? [''] : []),
    '\tres, _ := http.DefaultClient.Do(req)',
    '',
    '\tdefer res.Body.Close()',
    '\tbody, _ := io.ReadAll(res.Body)',
    '',
    '\tfmt.Println(string(body))',
    '',
    '}',
  ].join('\n')

// Unirest, as the live docs use it.
const javaSample = ({ method, url, headers, body }: SampleRequest) =>
  [
    `HttpResponse<String> response = Unirest.${method.toLowerCase()}(${q(url)})`,
    ...Object.entries(headers).map(([key, value]) => `  .header(${q(key)}, ${q(value)})`),
    ...(body ? [`  .body(${q(prettyBody(body))})`] : []),
    '  .asString();',
  ].join('\n')

// `#{`, `#$` and `#@` interpolate inside a Ruby double-quoted string.
const rubyString = (value: string) => q(value).replace(/#(?=[{$@])/g, '\\#')

const rubySample = ({ method, url, headers, body }: SampleRequest) => {
  const verb = method.toLowerCase().replace(/^./, (c) => c.toUpperCase())
  return [
    "require 'uri'",
    "require 'net/http'",
    '',
    `url = URI(${rubyString(url)})`,
    '',
    'http = Net::HTTP.new(url.host, url.port)',
    ...(url.startsWith('https:') ? ['http.use_ssl = true'] : []),
    '',
    `request = Net::HTTP::${verb}.new(url)`,
    ...Object.entries(headers).map(([key, value]) => `request[${rubyString(key)}] = ${rubyString(value)}`),
    ...(body ? [`request.body = ${rubyString(prettyBody(body))}`] : []),
    '',
    'response = http.request(request)',
    'puts response.read_body',
  ].join('\n')
}

const generators: Record<(typeof SAMPLE_LANGUAGES)[number], (request: SampleRequest) => string> = {
  cURL: (r) => buildCurlCommand(r.method, r.url, r.headers, r.body, r.form).join('\n'),
  Python: pythonSample,
  JavaScript: javascriptSample,
  PHP: phpSample,
  Go: goSample,
  Java: javaSample,
  Ruby: rubySample,
}

// Authored `lang` values that mean one of the generated languages.
const langAlias: Record<string, string> = { bash: 'curl', sh: 'curl', shell: 'curl', js: 'javascript', node: 'javascript', nodejs: 'javascript' }
const sampleKey = (label: string) => langAlias[label.toLowerCase()] ?? label.toLowerCase()

/**
 * The samples shown in the language dropdown. Authored `x-codeSamples` come
 * first and replace the generated sample for the same language; the other
 * generated languages follow. Generated samples need a URL, authored ones do not.
 * The `YOUR_API_KEY` Try it prefill is shown as `<token>`, as live does.
 */
export function buildCodeSamples(request: SampleRequest, authored: Array<CodeSample> = []): Array<CodeSample> {
  const shown = {
    ...request,
    headers: Object.fromEntries(Object.entries(request.headers).filter(([, v]) => v).map(([k, v]) => [k, v.replace(/YOUR_API_KEY/g, '<token>')])),
  }
  const taken = new Set(authored.map((sample) => sampleKey(sample.label)))
  const generated = request.url
    ? SAMPLE_LANGUAGES.filter((label) => !taken.has(sampleKey(label)) && (!request.form || label === 'cURL')).map((label) => ({ label, source: generators[label](shown) }))
    : []
  return [...authored, ...generated]
}
