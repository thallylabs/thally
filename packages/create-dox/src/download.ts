import { Readable, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import tar from 'tar'

const pipelineAsync = promisify(pipeline)

const TARBALL_URL = 'https://codeload.github.com/kenny-io/Dox/tar.gz/main'

const EXCLUDE_PATHS = ['/cli/', '/packages/', '/node_modules/', '/.git/']

function shouldInclude(path: string): boolean {
  for (const excluded of EXCLUDE_PATHS) {
    if (path.includes(excluded)) {
      return false
    }
  }
  return true
}

export async function downloadTemplate(targetDir: string, siteName?: string): Promise<void> {
  console.log('')
  console.log(`  ⏳ Creating ${siteName?.trim() || 'your docs site'}...`)

  const response = await fetch(TARBALL_URL)

  if (!response.ok) {
    throw new Error(`Failed to download template: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('Response body is empty')
  }

  // Convert Web Streams ReadableStream to Node.js Readable, then pipe into tar
  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])

  await pipelineAsync(
    nodeStream,
    tar.extract({ cwd: targetDir, strip: 1, filter: shouldInclude }),
  )
}
