import { z } from 'zod'
import { scaffold } from '../lib/scaffold.js'

export const createProjectSchema = z.object({
  projectDir: z.string().describe('Path where the new Dox project should be created'),
  projectName: z.string().optional().describe('Display name of the project (defaults to directory name)'),
  description: z.string().optional().describe('Short description of the project'),
  brandPreset: z.enum(['primary', 'secondary']).optional().default('primary').describe('Brand color preset'),
  repoUrl: z.string().optional().describe('GitHub repository URL (optional)'),
  install: z.boolean().optional().default(true).describe('Whether to run npm install after scaffolding'),
  enableAiChat: z.boolean().optional().default(true).describe('Enable AI chat in docs.json (default true)'),
  i18nLocales: z.array(z.object({ code: z.string(), label: z.string() })).optional().describe('Secondary locales to enable (e.g. [{code:"es",label:"Español"}])'),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

export async function handleCreateProject(input: CreateProjectInput): Promise<string> {
  const { projectDir, brandPreset = 'primary', install = true } = input

  // Derive project name from directory if not provided
  const dirBase = projectDir.split('/').filter(Boolean).pop() ?? 'my-docs'
  const projectName = input.projectName ?? dirBase
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const description = input.description ?? `Documentation for ${projectName}.`
  const repoUrl = input.repoUrl ?? ''

  const result = await scaffold({
    projectDir,
    projectName,
    description,
    brandPreset,
    repoUrl,
    doInstall: install,
    enableAiChat: input.enableAiChat ?? true,
    i18nLocales: input.i18nLocales,
  })

  const dirName = result.projectDir.split('/').pop() ?? projectDir

  return [
    `✅ Dox project "${projectName}" created at: ${result.projectDir}`,
    '',
    'Next steps:',
    `  cd ${dirName}`,
    '  npm run dev',
    '',
    'Then open http://localhost:3040 to see your docs.',
    '',
    'Key files to edit:',
    '  • src/data/site.ts   — name, links, branding',
    '  • docs.json          — navigation, AI chat config',
    '  • src/content/*.mdx  — your documentation',
    '',
    ...(input.enableAiChat !== false ? ['🤖 AI chat is enabled. Set ANTHROPIC_API_KEY in .env.local.'] : []),
  ].join('\n')
}
