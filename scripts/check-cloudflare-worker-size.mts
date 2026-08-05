/**
 * Enforce the managed builder's aggregate Worker upload contract.
 *
 * The builder accepts worker.js plus JavaScript, WebAssembly, and binary
 * modules, with a shared 32 MiB / 32-module ceiling. Checking the emitted
 * artifact here keeps local, CI, and release builds aligned with production.
 */

import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const MAX_WORKER_MODULE_COUNT = 32
const MAX_WORKER_BUNDLE_BYTES = 32 * 1024 * 1024
const uploadRoot = resolve(process.cwd(), '.thally-upload')

function isWorkerModule(path: string): boolean {
  return path === 'worker.js' || path.endsWith('.mjs') || path.endsWith('.wasm') || path.endsWith('.bin')
}

async function collectFiles(directory: string): Promise<Array<string>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return collectFiles(path)
      return entry.isFile() ? [path] : []
    }),
  )
  return nested.flat()
}

const uploadDirectory = await stat(uploadRoot).catch(() => null)
if (!uploadDirectory?.isDirectory()) {
  throw new Error(
    `Cloudflare Worker artifacts not found at ${uploadRoot}; run the OpenNext build first.`,
  )
}

const modules = (await collectFiles(uploadRoot))
  .map((absolutePath) => ({
    absolutePath,
    name: relative(uploadRoot, absolutePath).split(sep).join('/'),
  }))
  .filter(({ name }) => isWorkerModule(name))
  .sort((left, right) => left.name.localeCompare(right.name))

if (!modules.some(({ name }) => name === 'worker.js')) {
  throw new Error(`Cloudflare Worker entry module not found at ${join(uploadRoot, 'worker.js')}.`)
}
if (modules.length > MAX_WORKER_MODULE_COUNT) {
  throw new Error(
    `Cloudflare Worker has ${modules.length} modules, exceeding the managed-hosting limit of ${MAX_WORKER_MODULE_COUNT}.`,
  )
}

const sizes = await Promise.all(modules.map(({ absolutePath }) => stat(absolutePath)))
const totalBytes = sizes.reduce((sum, module) => sum + module.size, 0)
if (totalBytes > MAX_WORKER_BUNDLE_BYTES) {
  throw new Error(
    `Cloudflare Worker bundle is ${totalBytes} bytes, exceeding the managed-hosting limit of ${MAX_WORKER_BUNDLE_BYTES} bytes.`,
  )
}

console.log(
  `Cloudflare Worker bundle: ${modules.length}/32 modules · ${(totalBytes / 1024 / 1024).toFixed(2)} MiB / 32.00 MiB`,
)
