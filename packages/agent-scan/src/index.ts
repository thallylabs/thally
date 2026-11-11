import { readFileSync } from 'node:fs'
import spec from './methodology/methodology-v1.0.json' with { type: 'json' }

/** Methodology stub. */
export const methodology = spec
/** Version stub. */
export const scannerVersion: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
