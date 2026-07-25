/**
 * Build the workspace packages in dependency order, parallelizing where the
 * dependency graph allows.
 *
 * The graph (from each package's tsup config and dependencies):
 * - core, migrate, mcp, and create-thally-docs have no @thallylabs/* build-time
 *   dependencies — they build concurrently.
 * - agent marks @thallylabs/mcp external at runtime, but its `dts: true`
 *   type build reads mcp's generated declarations — it builds after mcp.
 * - cli sets `noExternal: ['@thallylabs/agent']`, bundling agent's dist into
 *   the CLI at build time — it must build last.
 *
 * The previous fully-serial `npm run build -w … && …` chain paid all five
 * builds back to back on every engine build; the fan-out keeps the ordering
 * constraints while letting the independent half run at once.
 */

import { spawn } from 'node:child_process'

function buildWorkspace(workspace) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'build', '-w', workspace], {
      stdio: 'inherit',
      // npm resolves via a .cmd shim on Windows, which spawn only finds
      // through a shell.
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(`${workspace} build failed (${signal ?? `exit ${code}`})`),
        )
    })
  })
}

await Promise.all(
  ['packages/core', 'packages/migrate', 'packages/mcp', 'packages/create-thally-docs'].map(
    buildWorkspace,
  ),
)
await buildWorkspace('packages/agent')
await buildWorkspace('packages/cli')
