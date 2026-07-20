import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { logo, success, slugify } from './utils.js'
import { gatherAnswers } from './prompts.js'
import { scaffold } from './scaffold.js'
import { parseGitHubRepositoryUrl } from '@thallylabs/migrate'
import { migrateDocs } from './migrate/index.js'
import { runCheck } from './check.js'
import { runTranslateCommand } from './translate.js'

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('-'))
const valueFlags = new Set([
  '--api-key',
  '--branch',
  '--docs-dir',
  '--into',
  '--locale',
  '--model',
  '--pages',
])

// Build positionals by skipping values consumed by named flags (e.g. --locale es)
const positional: Array<string> = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('-')) {
    // Only named value flags consume the next token. Boolean flags such as
    // --yes and --install can safely appear before the project directory.
    if (valueFlags.has(args[i]) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      i++
    }
  } else {
    positional.push(args[i])
  }
}

function getFlagValue(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
    return args[idx + 1]
  }
  return undefined
}

async function runMigrateCommand(): Promise<void> {
  const sourceUrl = positional[1]
  if (!sourceUrl) {
    console.error('\n  ❌ Source URL is required.')
    console.error('     Usage: create-thally-docs migrate <github-or-docs-url> [output-dir] [options]')
    console.error('     Example: create-thally-docs migrate https://docs.example.com my-docs')
    process.exit(1)
  }

  let source: URL
  try {
    source = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Only HTTP and HTTPS sources are supported.')
    if (source.hostname.toLowerCase() === 'github.com') parseGitHubRepositoryUrl(sourceUrl)
  } catch (err) {
    console.error(`\n  ❌ ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  // API key is optional — only needed for non-Markdown files
  const apiKey = getFlagValue('--api-key') ?? process.env.ANTHROPIC_API_KEY

  // Parse --into flag
  const intoDir = getFlagValue('--into')
  const isInto = Boolean(intoDir)

  // Determine project directory
  let projectDir: string
  if (intoDir) {
    projectDir = resolve(intoDir)
  } else if (positional[2]) {
    projectDir = resolve(positional[2])
  } else {
    const sourceName = source.hostname.toLowerCase() === 'github.com'
      ? parseGitHubRepositoryUrl(sourceUrl).repo
      : source.pathname.split('/').filter(Boolean).at(-1) ?? source.hostname.split('.')[0]
    projectDir = resolve(`${slugify(sourceName)}-docs`)
  }

  const branch = getFlagValue('--branch')
  const docsDir = getFlagValue('--docs-dir')
  const maxPagesValue = getFlagValue('--max-pages')
  const maxPages = maxPagesValue ? Number(maxPagesValue) : undefined
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000)) {
    console.error('\n  ❌ --max-pages must be an integer between 1 and 1000.')
    process.exit(1)
  }
  const yes = flags.includes('--yes') || flags.includes('-y')

  logo()
  console.log('  🚀 Thally Migrate')
  console.log('')
  console.log(`  Source:  ${sourceUrl}`)
  console.log(`  Target:  ${projectDir}`)
  if (branch) console.log(`  Branch:  ${branch}`)
  if (docsDir) console.log(`  Docs dir: ${docsDir}`)
  console.log('')

  await migrateDocs({
    sourceUrl,
    projectDir,
    into: isInto,
    apiKey,
    branch,
    docsDir,
    maxPages,
    yes,
  })
}

async function runScaffoldCommand(): Promise<void> {
  const useDefaults = flags.includes('--yes') || flags.includes('-y')
  const installPreference = flags.includes('--install')
    ? true
    : flags.includes('--no-install')
      ? false
      : undefined
  const dirArg = positional[0]

  // Early validation when dir is passed via positional arg
  if (dirArg) {
    const resolved = resolve(dirArg)
    if (existsSync(resolved) && readdirSync(resolved).length > 0) {
      console.error(`\n  ❌ Directory "${resolved}" already exists and is not empty.`)
      process.exit(1)
    }
  }

  const answers = await gatherAnswers(dirArg, useDefaults, installPreference)

  const result = await scaffold({
    projectDir: answers.projectDir,
    projectName: answers.projectName,
    description: answers.description,
    brandPreset: answers.brandPreset,
    repoUrl: answers.repoUrl,
    doInstall: answers.doInstall,
    i18nLocales: answers.i18nLocales,
    trackRepos: answers.trackRepos,
  })

  success(result.projectDir, answers.projectName, answers.doInstall)
}

async function runCheckCommand(): Promise<void> {
  const projectDir = resolve(positional[1] ?? '.')
  const exitCode = await runCheck(projectDir, {
    fix: flags.includes('--fix'),
    ci: flags.includes('--ci'),
    external: flags.includes('--external'),
    drift: flags.includes('--drift'),
  })
  process.exit(exitCode)
}

async function runTranslateSubcommand(): Promise<void> {
  const locale = getFlagValue('--locale')
  if (!locale) {
    console.error('\n  ❌ --locale is required.')
    console.error('     Usage: create-thally-docs translate --locale es [--pages page1,page2] [--force] [--api-key key]')
    process.exit(1)
  }

  const pagesArg = getFlagValue('--pages')
  const pages = pagesArg ? pagesArg.split(',').map((p) => p.trim()).filter(Boolean) : undefined
  const force = flags.includes('--force')
  const apiKey = getFlagValue('--api-key') ?? process.env.ANTHROPIC_API_KEY
  const model = getFlagValue('--model') ?? 'claude-sonnet-4-6'
  const yes = flags.includes('--yes') || flags.includes('-y')
  const projectDir = resolve(positional[1] ?? '.')

  logo()
  console.log('  🌐 Thally Translate')
  console.log('')

  await runTranslateCommand(locale, pages, force, apiKey, model, yes, projectDir)
}

async function main(): Promise<void> {
  const subcommand = positional[0]

  if (subcommand === 'migrate') {
    await runMigrateCommand()
  } else if (subcommand === 'check') {
    await runCheckCommand()
  } else if (subcommand === 'translate') {
    await runTranslateSubcommand()
  } else {
    logo()
    await runScaffoldCommand()
  }
}

main().catch((err: Error) => {
  console.error('\n  ❌ Error:', err.message)
  process.exit(1)
})
