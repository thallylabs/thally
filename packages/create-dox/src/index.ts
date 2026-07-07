import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { logo, success, slugify } from './utils.js'
import { gatherAnswers } from './prompts.js'
import { scaffold } from './scaffold.js'
import { parseGitHubUrl } from './migrate/github.js'
import { migrateDocs } from './migrate/index.js'
import { runCheck } from './check.js'
import { runTranslateCommand } from './translate.js'

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('-'))

// Build positionals by skipping values consumed by named flags (e.g. --locale es)
const positional: Array<string> = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('-')) {
    // If the next token doesn't start with '-', it's this flag's value — skip it
    if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
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
    console.error('     Usage: create-dox migrate <github-url> [output-dir] [options]')
    console.error('     Example: create-dox migrate https://github.com/mintlify/docs my-docs')
    process.exit(1)
  }

  // Validate GitHub URL
  let parsedSource: ReturnType<typeof parseGitHubUrl>
  try {
    parsedSource = parseGitHubUrl(sourceUrl)
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
    // Derive from repo name
    projectDir = resolve(`${slugify(parsedSource.repo)}-docs`)
  }

  const branch = getFlagValue('--branch')
  const docsDir = getFlagValue('--docs-dir')
  const yes = flags.includes('--yes') || flags.includes('-y')

  logo()
  console.log('  🚀 Dox Migrate')
  console.log('')
  console.log(`  Source:  ${sourceUrl}`)
  console.log(`  Target:  ${projectDir}`)
  if (branch) console.log(`  Branch:  ${branch}`)
  if (docsDir) console.log(`  Docs dir: ${docsDir}`)
  console.log('')

  if (!apiKey) {
    console.warn('  ⚠  No API key provided. Non-Markdown files will be skipped.')
    console.warn('     Set ANTHROPIC_API_KEY=... or pass --api-key <key> to convert them.')
    console.warn('')
  }

  await migrateDocs({
    sourceUrl,
    projectDir,
    into: isInto,
    apiKey,
    branch,
    docsDir,
    yes,
  })
}

async function runScaffoldCommand(): Promise<void> {
  const useDefaults = flags.includes('--yes') || flags.includes('-y')
  const dirArg = positional[0]

  // Early validation when dir is passed via positional arg
  if (dirArg) {
    const resolved = resolve(dirArg)
    if (existsSync(resolved) && readdirSync(resolved).length > 0) {
      console.error(`\n  ❌ Directory "${resolved}" already exists and is not empty.`)
      process.exit(1)
    }
  }

  const answers = await gatherAnswers(dirArg, useDefaults)

  const result = await scaffold({
    projectDir: answers.projectDir,
    projectName: answers.projectName,
    description: answers.description,
    brandPreset: answers.brandPreset,
    repoUrl: answers.repoUrl,
    doInstall: answers.doInstall,
    i18nLocales: answers.i18nLocales,
  })

  success(result.projectDir, answers.projectName)
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
    console.error('     Usage: create-dox translate --locale es [--pages page1,page2] [--force] [--api-key key]')
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
  console.log('  🌐 Dox Translate')
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
