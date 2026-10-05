/**
 * Shared terminal presentation for the public CLI and project creator.
 * Decoration is opt-in by terminal capability; pipes, CI, and NO_COLOR retain
 * an append-only transcript. Untrusted source text never controls the terminal.
 */
import { intro, outro, spinner } from '@clack/prompts'
import { stripVTControlCharacters } from 'node:util'

/** Product-wide promise; command subtitles describe the immediate task. */
export const PRODUCT_TAGLINE = 'Product knowledge, kept in step with your code.'

// The leaf artwork uses #AEBB6A on dark surfaces and #737938 on light ones.
// Use exact RGB when supported, and the nearest xterm palette colors otherwise.
const OLIVE = { rgb: '38;2;174;187;106', palette: '38;5;143' }
const OLIVE_EDGE = { rgb: '38;2;115;121;56', palette: '38;5;101' }

function oliveCode(env: NodeJS.ProcessEnv, edge = false): string {
  const color = edge ? OLIVE_EDGE : OLIVE
  return env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit'
    || ['iTerm.app', 'vscode', 'WezTerm'].includes(env.TERM_PROGRAM ?? '')
    ? color.rgb : color.palette
}

let accentUsers = 0
let restoreAccent: (() => void) | undefined

/**
 * Scope Clack's fixed cyan/magenta/green UI colors to our olive accent.
 * Clack 0.11 has no theme option. Adapt only its color SGRs while a prompt or
 * spinner owns stdout; preserve text, cursor controls, warnings, and errors.
 * Release restores the original writer, including on cancellation or failure.
 */
export function acquireTerminalAccent(): () => void {
  if (!terminal.isRich) return () => {}
  if (accentUsers === 0) {
    const output = process.stdout
    const previous = output.write
    const writeOriginal = previous.bind(output)
    const opening = `\x1b[${oliveCode(process.env)}m`
    const themed: typeof output.write = function (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) {
      const text = typeof chunk === 'string' ? chunk.replace(/\x1b\[(?:32|35|36)m/g, opening) : chunk
      return typeof encodingOrCallback === 'string'
        ? writeOriginal(text, encodingOrCallback, callback)
        : writeOriginal(text, encodingOrCallback)
    }
    output.write = themed
    restoreAccent = () => { if (output.write === themed) output.write = previous }
  }
  accentUsers += 1
  let released = false
  return () => {
    if (released) return
    released = true
    accentUsers -= 1
    if (accentUsers === 0) { restoreAccent?.(); restoreAccent = undefined }
  }
}

// Keep the recognizable beveled lettering without a box around the workflow.
// Every glyph occupies one terminal cell; narrow terminals get a smaller mark.
const WORDMARK = [
  '████████╗██╗  ██╗ █████╗ ██╗     ██╗     ██╗   ██╗',
  '╚══██╔══╝██║  ██║██╔══██╗██║     ██║     ╚██╗ ██╔╝',
  '   ██║   ███████║███████║██║     ██║      ╚████╔╝ ',
  '   ██║   ██╔══██║██╔══██║██║     ██║       ╚██╔╝  ',
  '   ██║   ██║  ██║██║  ██║███████╗███████╗   ██║   ',
  '   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ',
]
const SMALL_WORDMARK = [
  '▀█▀ █ █ ▄▀█ █   █   █ █',
  ' █  █▀█ █▀█ █   █    █ ',
  ' ▀  ▀ ▀ ▀ ▀ ▀▀▀ ▀▀▀  ▀ ',
]

export interface TerminalOptions {
  stdout?: Pick<NodeJS.WriteStream, 'write' | 'isTTY' | 'columns'>
  stderr?: Pick<NodeJS.WriteStream, 'write' | 'isTTY' | 'columns'>
  env?: NodeJS.ProcessEnv
  argv?: Array<string>
}

/** Remove terminal escape sequences and non-printing controls from source text. */
export function terminalText(value: string): string {
  // Keep line breaks for diagnostics, but reject carriage returns, OSC links,
  // and cursor commands that could conceal warnings or overwrite a result.
  return stripVTControlCharacters(value).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
}

/** Create a terminal renderer; injected streams support deterministic transcripts. */
export function createTerminal(options: TerminalOptions = {}) {
  const output = options.stdout ?? process.stdout
  const errors = options.stderr ?? process.stderr
  const environment = () => options.env ?? process.env
  const arguments_ = () => options.argv ?? process.argv.slice(2)
  const isRich = () => Boolean(output.isTTY)
    && !environment().CI && environment().TERM !== 'dumb'
    && environment().NO_COLOR === undefined
  // Clack owns the real process streams and cursor; never animate custom streams
  // or compete with verbose subprocess output for the current terminal line.
  const canAnimate = () => isRich() && Boolean(process.stdin.isTTY)
    && output === process.stdout && errors === process.stderr
    && !arguments_().includes('--verbose')
  const paint = (text: string, code: number | string, rich = isRich()) => rich ? `\x1b[${code}m${text}\x1b[0m` : text
  const accent = (text: string, edge = false) => paint(text, oliveCode(environment(), edge))
  const write = (text: string) => output.write(`${text}\n`)
  const wordmark = () => {
    const columns = output.columns ?? 80
    const lines = columns >= Math.max(...WORDMARK.map((line) => line.length)) + 2
      ? WORDMARK : SMALL_WORDMARK
    // Extremely narrow terminals and append-only output use readable plain text.
    if (!isRich() || columns < Math.max(...lines.map((line) => line.length)) + 2) {
      write(`  ${accent('THALLY')}`)
      return
    }
    const lettering = lines.map((line) => line.split(/(█+)/).map((part) => accent(part, !part.includes('█'))).join(''))
    for (const line of lettering) write(`  ${line}`)
  }
  const diagnostic = (message: string, isError: boolean) => {
    const rich = isRich() && Boolean(errors.isTTY)
    const symbol = isError ? (rich ? '■' : '[error]') : (rich ? '▲' : '[warn]')
    const line = `  ${paint(symbol, isError ? 31 : 33, rich)} ${terminalText(message)}`
    // Preserve the console warning boundary used by existing callers/tests.
    if (errors === process.stderr) console.warn(line)
    else errors.write(`${line}\n`)
  }
  const render = {
    /** Whether interactive decoration is supported by the current output. */
    get isRich() { return isRich() },
    /** Whether the caller requested detailed subprocess output. */
    get isVerbose() { return arguments_().includes('--verbose') },
    /** Introduce a command with the responsive wordmark and its immediate task. */
    intro(command: string, version?: string, subtitle = PRODUCT_TAGLINE): void {
      const heading = `${terminalText(command)}${version ? ` ${isRich() ? '·' : '-'} v${terminalText(version)}` : ''}`
      write('')
      wordmark()
      write('')
      write(`  ${PRODUCT_TAGLINE}`)
      if (subtitle !== PRODUCT_TAGLINE) write(`  ${paint(terminalText(subtitle), 2)}`)
      write('')
      if (isRich() && output === process.stdout) intro(accent(heading))
      else write(`  ${accent(heading)}`)
      write('')
    },
    /** Display a source, destination, or result with a consistent label. */
    detail(label: string, value: string): void {
      write(`  ${paint(terminalText(label).padEnd(10), 2)} ${terminalText(value)}`)
    },
    /** Display a neutral fact without implying success. */
    info(message: string): void { write(`  ${paint(isRich() ? '│' : '-', 2)} ${terminalText(message)}`) },
    /** Record a completed operation in the retained transcript. */
    success(message: string): void { write(`  ${accent(isRich() ? '✓' : '[ok]')} ${terminalText(message)}`) },
    /** Keep warnings visible on stderr even when successful task logs are quiet. */
    warn(message: string): void { diagnostic(message, false) },
    /** Keep errors visible on stderr and separate from machine-readable stdout. */
    error(message: string): void { diagnostic(message, true) },
    /** Group next steps or results without a fixed-width box. */
    section(title: string, lines: Array<string>): void {
      write('')
      write(`  ${paint(terminalText(title), 1)}`)
      for (const line of lines) write(`    ${terminalText(line)}`)
      write('')
    },
    /** Make the next action prominent while retaining one intact shell command. */
    nextAction(title: string, command: string): void {
      const cleanTitle = terminalText(title)
      const cleanCommand = terminalText(command)
      write('')
      if (!isRich()) {
        write(`  Next action: ${cleanTitle}`)
        write('  Copy and run this command:')
        write(`    ${cleanCommand}`)
        write('')
        return
      }
      const label = `NEXT → ${cleanTitle}`
      write(`  ${paint(paint(paint(` ${label} `, 1), 30), oliveCode(environment()).replace(/^38;/, '48;'))}`)
      write('')
      write('  Copy and run to open your local preview:')
      // A long command must never be wrapped or truncated by the renderer.
      // Natural terminal wrapping preserves copy/paste; inserted newlines don't.
      const canFrame = !cleanCommand.includes('\n') && cleanCommand.length + 8 <= (output.columns ?? 80)
      if (canFrame) {
        const width = cleanCommand.length + 4
        write(`  ${accent(`╭${'─'.repeat(width)}╮`)}`)
        write(`  ${accent('│')}${' '.repeat(width)}${accent('│')}`)
        write(`  ${accent('│')}  ${accent(paint(cleanCommand, 1))}  ${accent('│')}`)
        write(`  ${accent('│')}${' '.repeat(width)}${accent('│')}`)
        write(`  ${accent(`╰${'─'.repeat(width)}╯`)}`)
      } else write(`    ${accent(paint(cleanCommand, 1))}`)
      write('')
    },
    /** Finish a command without masking warnings or incomplete validation. */
    outro(message: string): void {
      if (isRich() && output === process.stdout) outro(terminalText(message))
      else { write(''); write(`  ${terminalText(message)}`); write('') }
    },
    /** Render progress, retain the outcome, and always release Clack's cursor hooks. */
    async step<T>(label: string, action: (update: (message: string) => void) => T | Promise<T>, completedLabel = label): Promise<T> {
      const progress = canAnimate() ? spinner({ indicator: 'timer' }) : undefined
      const releaseAccent = progress ? acquireTerminalAccent() : undefined
      const cleanLabel = terminalText(label).replace(/\n/g, ' ')
      // A transient label must fit on one physical line for safe cursor erasure.
      const limit = Math.max(8, (output.columns ?? 80) - 16)
      const fit = (message: string) => Array.from(terminalText(message).replace(/\n/g, ' ')).slice(0, limit).join('')
      let activity = cleanLabel
      const began = Date.now()
      const update = (message: string) => {
        const next = terminalText(message).replace(/\n/g, ' ')
        if (next === activity) return
        activity = next
        if (progress) progress.message(fit(next))
        else render.info(next)
      }
      // Append-only logs also need a heartbeat: a stalled network or long build
      // must not look like a dead process when animation is disabled.
      const heartbeat = !progress ? setInterval(() => {
        render.info(`${activity} (${Math.floor((Date.now() - began) / 1000)}s elapsed)`)
      }, 15_000) : undefined
      const cancel = () => { progress?.stop('Cancelled', 1); releaseAccent?.(); process.exit(130) }
      const terminate = () => { progress?.stop('Cancelled', 1); releaseAccent?.(); process.exit(143) }
      // Clack restores the cursor on a signal but does not terminate the task.
      // Preserve the normal CLI cancellation contract while its hooks are active.
      if (progress) { process.once('SIGINT', cancel); process.once('SIGTERM', terminate) }
      try {
        if (progress) progress.start(fit(cleanLabel))
        else render.info(cleanLabel)
        const result = await action(update)
        if (progress) progress.stop(terminalText(completedLabel))
        else render.success(completedLabel)
        return result
      } catch (error) {
        if (progress) progress.stop(`${cleanLabel}: failed`, 2)
        else render.error(`${cleanLabel}: failed`)
        throw error
      } finally {
        releaseAccent?.()
        if (heartbeat) clearInterval(heartbeat)
        if (progress) { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', terminate) }
      }
    },
  }
  return render
}

/** Process-local shared presentation; importing it never writes output. */
export const terminal = createTerminal()

/** Highlight help headings only on capable terminals; preserve plain help bytes otherwise. */
export function formatHelp(text: string): string {
  if (!terminal.isRich) return text
  return text.replace(/^(\s*)([^\n]+:)$/gm, `$1\x1b[${oliveCode(process.env)}m$2\x1b[0m`)
}
