import { z } from 'zod'
import { migrateDocs } from '../lib/migrate/index.js'

export const migrateDocsSchema = z.object({
  sourceUrl: z.string().describe('GitHub URL of the docs repo to migrate'),
  projectDir: z.string().describe('Path for new project or existing project dir'),
  into: z.boolean().optional().default(false).describe('Migrate into existing project instead of scaffolding'),
  branch: z.string().optional().describe('Git branch (default: auto-detect)'),
  docsDir: z.string().optional().describe('Docs subdirectory in repo (default: auto-detect)'),
  apiKey: z.string().optional().describe('Anthropic API key for non-Markdown file conversion'),
})

export async function handleMigrateDocs(input: z.infer<typeof migrateDocsSchema>): Promise<string> {
  const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY

  const result = await migrateDocs({
    sourceUrl: input.sourceUrl,
    projectDir: input.projectDir,
    into: input.into ?? false,
    apiKey,
    branch: input.branch,
    docsDir: input.docsDir,
    yes: true,
  })

  return `Migration complete! ${result.pagesWritten} pages written to ${result.projectDir}/src/content/`
}
