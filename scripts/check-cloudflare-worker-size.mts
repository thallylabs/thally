/**
 * Enforce the managed builder's single-module upload contract.
 *
 * The builder reads `.thally-upload/worker.js` into one Worker module and
 * rejects files above 32 MiB. Checking the emitted artifact here keeps local,
 * CI, and release builds aligned with that production boundary.
 */

import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const MAX_WORKER_MODULE_BYTES = 32 * 1024 * 1024
const workerPath = resolve(process.cwd(), '.thally-upload/worker.js')

const worker = await stat(workerPath).catch(() => null)

if (!worker?.isFile()) {
  throw new Error(
    `Cloudflare Worker artifact not found at ${workerPath}; run the OpenNext build first.`,
  )
}

if (worker.size > MAX_WORKER_MODULE_BYTES) {
  throw new Error(
    `Cloudflare Worker is ${worker.size} bytes, exceeding the managed-hosting limit of ${MAX_WORKER_MODULE_BYTES} bytes.`,
  )
}

console.log(
  `Cloudflare Worker size: ${(worker.size / 1024 / 1024).toFixed(2)} MiB / 32.00 MiB`,
)
