/**
 * Keep setup prompts aligned with terminal presentation without changing answer
 * contracts. Inquirer remains the plain-terminal fallback; Clack owns rich UI.
 */
import * as clack from '@clack/prompts'
import * as inquirer from '@inquirer/prompts'
import { terminal, acquireTerminalAccent } from './terminal.js'

/** Release Clack's scoped accent even when a prompt rejects or is cancelled. */
async function withAccent<Value>(prompt: () => Promise<Value>): Promise<Value> {
  const release = acquireTerminalAccent()
  try { return await prompt() } finally { release() }
}

interface InputOptions {
  message: string
  default?: string
  validate?: (value: string) => true | string
}

interface SelectOptions<Value> {
  message: string
  choices: Array<{ name: string; value: Value }>
  default?: Value
}

interface ConfirmOptions {
  message: string
  default?: boolean
}

/** Convert a prompt cancellation into the same error handled by command runners. */
function answerOrCancel<Value>(answer: Value | symbol): Value {
  if (clack.isCancel(answer)) {
    throw Object.assign(new Error('Cancelled.'), { exitCode: 130 })
  }
  return answer as Value
}

/** Ask for text with the existing defaults and validation contract. */
export async function input(options: InputOptions): Promise<string> {
  if (!terminal.isRich) return inquirer.input(options)
  return answerOrCancel(await withAccent(() => clack.text({
    message: options.message.trim(),
    initialValue: options.default,
    // Clack otherwise finalizes an empty answer as undefined. Optional fields
    // such as the repository URL must keep Inquirer's empty-string contract.
    defaultValue: '',
    validate: options.validate
      ? (value) => {
          const result = options.validate!(value)
          return result === true ? undefined : result
        }
      : undefined,
  })))
}

/** Select a typed answer while preserving undefined for automatic detection. */
export async function select<Value>(options: SelectOptions<Value>): Promise<Value> {
  if (!terminal.isRich) return inquirer.select<Value>(options)
  return answerOrCancel(await withAccent(() => clack.select<Value>({
    message: options.message.trim(),
    initialValue: options.default,
    // Every existing choice has a label, including nonprimitive values such as
    // undefined; Clack's conditional Option type cannot infer this for a generic.
    options: options.choices.map((choice) => ({
      label: choice.name,
      value: choice.value,
    })) as Array<clack.Option<Value>>,
  })))
}

/** Ask for explicit consent without changing the caller's default answer. */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  if (!terminal.isRich) return inquirer.confirm(options)
  return answerOrCancel(await withAccent(() => clack.confirm({
    message: options.message.trim(),
    initialValue: options.default ?? true,
  })))
}
