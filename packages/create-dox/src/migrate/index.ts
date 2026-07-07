import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import pLimit from 'p-limit'
import { parseGitHubUrl, cloneRepo, detectDocsDir, findDocFiles, detectOpenApiSpec, copyStaticAssets } from './github.js'
import { importFile, type ImportedPage } from './importer.js'
import { buildNavStructure, detectNavFromConfig, detectPlatform, type DocsJsonConfig } from './nav-builder.js'
import { scaffold } from '../scaffold.js'
import { installDeps, initGit } from '../utils.js'

export interface MigrateOptions {
  sourceUrl: string
  projectDir: string
  into: boolean
  apiKey?: string      // Optional — only needed for non-MD files
  branch?: string      // Override auto-detected branch
  docsDir?: string     // Override auto-detected docs directory
  projectName?: string
  yes: boolean
}

export interface MigrateResult {
  pagesWritten: number
  projectDir: string
}

function readDocsJson(projectDir: string): DocsJsonConfig {
  const docsPath = join(projectDir, 'docs.json')
  const raw = readFileSync(docsPath, 'utf8')
  return JSON.parse(raw) as DocsJsonConfig
}

function writeDocsJson(projectDir: string, config: DocsJsonConfig): void {
  const docsPath = join(projectDir, 'docs.json')
  writeFileSync(docsPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

function mergeDocsJson(existing: DocsJsonConfig, incoming: DocsJsonConfig): DocsJsonConfig {
  const existingTabNames = new Set(existing.tabs.map((t) => t.tab))
  const merged = { tabs: [...existing.tabs.filter((t) => t.tab !== 'Changelog')] }

  for (const tab of incoming.tabs) {
    if (tab.tab === 'Changelog') continue
    if (existingTabNames.has(tab.tab)) {
      const existingTab = merged.tabs.find((t) => t.tab === tab.tab)!
      if (existingTab.groups && tab.groups) {
        const existingGroupNames = new Set(existingTab.groups.map((g) => g.group))
        for (const group of tab.groups) {
          if (existingGroupNames.has(group.group)) {
            const eg = existingTab.groups.find((g) => g.group === group.group)!
            const existingPageSet = new Set(eg.pages.map((p) => (typeof p === 'string' ? p : p.group)))
            for (const page of group.pages) {
              const key = typeof page === 'string' ? page : page.group
              if (!existingPageSet.has(key)) eg.pages.push(page)
            }
          } else {
            existingTab.groups.push(group)
          }
        }
      } else if (tab.groups) {
        existingTab.groups = tab.groups
      }
    } else {
      merged.tabs.push(tab)
    }
  }

  merged.tabs.push({ tab: 'Changelog', href: '/changelog' })
  return merged
}

function injectApiTab(config: DocsJsonConfig, specFilename: string): DocsJsonConfig {
  const tabs = [...config.tabs]

  // Find any existing API tab from nav detection (may have groups with MDX pages)
  const existingApiIdx = tabs.findIndex((t) => t.tab.toLowerCase().includes('api'))

  if (existingApiIdx >= 0) {
    const existing = tabs[existingApiIdx]
    // If the existing API tab has groups with MDX pages, keep them and add the spec source
    if (existing.groups && existing.groups.length > 0) {
      tabs[existingApiIdx] = {
        ...existing,
        api: { source: `/${specFilename}` },
      }
    } else {
      // No groups — replace with pure spec-based tab
      tabs[existingApiIdx] = { tab: existing.tab, api: { source: `/${specFilename}` } }
    }
  } else {
    // No existing API tab — insert before Changelog
    const apiTab = { tab: 'API Reference', api: { source: `/${specFilename}` } }
    const changelogIdx = tabs.findIndex((t) => t.tab === 'Changelog')
    if (changelogIdx >= 0) {
      tabs.splice(changelogIdx, 0, apiTab)
    } else {
      tabs.push(apiTab)
    }
  }

  return { ...config, tabs }
}

export async function migrateDocs(opts: MigrateOptions): Promise<MigrateResult> {
  const { sourceUrl, projectDir: rawProjectDir, into, apiKey, projectName } = opts
  const projectDir = resolve(rawProjectDir)

  // Step 1: Parse GitHub URL
  const source = parseGitHubUrl(sourceUrl)
  if (opts.branch) source.branch = opts.branch

  // Step 2: Scaffold if not --into
  if (!into) {
    console.log(`\n  🏗  Scaffolding new project at ${projectDir}...`)
    await scaffold({
      projectDir,
      projectName: projectName ?? 'My Docs',
      description: `Documentation migrated from ${source.owner}/${source.repo}`,
      brandPreset: 'primary',
      repoUrl: `https://github.com/${source.owner}/${source.repo}`,
      doInstall: false,
    })
  } else {
    if (!existsSync(projectDir)) {
      throw new Error(
        `Project directory "${projectDir}" does not exist. Use without --into to scaffold a new one.`,
      )
    }
  }

  // Step 3: Clone to temp dir
  const tmpBase = mkdtempSync(join(tmpdir(), 'dox-migrate-'))
  const cloneDir = join(tmpBase, 'repo')

  console.log(`\n  📦 Cloning ${source.owner}/${source.repo}...`)

  try {
    await cloneRepo(source, cloneDir)

    // Step 4: Detect platform early — it affects docsDir detection
    const platform = detectPlatform(cloneDir)

    // Step 5: Detect docs dir
    // For Mintlify, page refs are relative to repo root, so docsDir should be ''
    let docsDir: string
    if (opts.docsDir) {
      docsDir = opts.docsDir
    } else if (source.docsDir) {
      docsDir = source.docsDir
    } else if (platform === 'mintlify') {
      // Mintlify repos have docs at the root — don't guess a subdirectory
      docsDir = ''
    } else {
      docsDir = detectDocsDir(cloneDir)
    }

    // Step 6: Find doc files (skip i18n directories for Mintlify)
    const hasI18n = platform === 'mintlify'
    const docFiles = findDocFiles(cloneDir, docsDir, hasI18n)
    const docsDirLabel = docsDir ? `${docsDir}/` : 'repo root'
    console.log(`  📄 Found ${docFiles.length} files in ${docsDirLabel}`)

    if (docFiles.length === 0) {
      console.warn('  ⚠  No doc files found. Check the URL and try again.')
      return { pagesWritten: 0, projectDir }
    }

    // Step 6b: Detect nav config from platform config file
    const detectedNav = detectNavFromConfig(cloneDir, docsDir, platform)

    // Step 6b: Detect OpenAPI spec in the source repo
    const openApiSpec = detectOpenApiSpec(cloneDir)
    if (openApiSpec) {
      console.log(`  🔌 Found OpenAPI spec: ${openApiSpec.filename}`)
    }

    // Step 7: Import all files concurrently
    const limit = pLimit(5)
    let doneCount = 0
    const imported = (
      await Promise.all(
        docFiles.map((file) =>
          limit(async () => {
            try {
              const result = await importFile(file, apiKey)
              doneCount++
              if (result) {
                console.log(`    [${doneCount}/${docFiles.length}] ${result.pageId}`)
              } else {
                console.log(`    [${doneCount}/${docFiles.length}] ${file.pageId} (openapi — wired via spec)`)
              }
              return result
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes('no API key')) {
                console.warn(`    ⚠  ${msg}`)
              } else {
                console.warn(`    ⚠  Skipping ${file.relPath}: ${msg}`)
              }
              doneCount++
              return null
            }
          }),
        ),
      )
    ).filter(Boolean) as ImportedPage[]

    // Step 8: Deduplicate by pageId (first wins)
    const pageIdSeen = new Set<string>()
    const deduped = imported.filter((p) => {
      if (pageIdSeen.has(p.pageId)) return false
      pageIdSeen.add(p.pageId)
      return true
    })

    // Step 9: Write MDX files
    const contentDir = join(projectDir, 'src', 'content')
    let pagesWritten = 0
    for (const page of deduped) {
      const filePath = join(contentDir, `${page.pageId}.mdx`)
      mkdirSync(dirname(filePath), { recursive: true })

      const mdx = [
        '---',
        `title: "${page.frontmatter.title.replace(/"/g, '\\"')}"`,
        `description: "${page.frontmatter.description.replace(/"/g, '\\"')}"`,
        page.frontmatter.keywords.length > 0
          ? `keywords: [${page.frontmatter.keywords.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(', ')}]`
          : null,
        '---',
        '',
        page.body,
      ]
        .filter((line) => line !== null)
        .join('\n')

      writeFileSync(filePath, mdx, 'utf8')
      pagesWritten++
    }

    // Step 9b: Copy static assets (images, media) from source repo
    const publicDir = join(projectDir, 'public')
    mkdirSync(publicDir, { recursive: true })
    const assetCount = copyStaticAssets(cloneDir, docsDir, publicDir)
    if (assetCount > 0) {
      console.log(`  🖼  Copied ${assetCount} static assets → public/`)
    }

    // Step 9c: Copy OpenAPI spec to public/ and inject API tab into nav
    let finalNav = detectedNav ?? buildNavStructure(deduped)
    if (openApiSpec) {
      copyFileSync(openApiSpec.absPath, join(publicDir, openApiSpec.filename))
      console.log(`  📋 Copied ${openApiSpec.filename} → public/${openApiSpec.filename}`)
      finalNav = injectApiTab(finalNav, openApiSpec.filename)
    }

    // Step 10: Write docs.json
    if (into && existsSync(join(projectDir, 'docs.json'))) {
      const existing = readDocsJson(projectDir)
      const merged = mergeDocsJson(existing, finalNav)
      writeDocsJson(projectDir, merged)
    } else {
      writeDocsJson(projectDir, finalNav)
    }

    // Step 11: Install deps + git (only for new projects)
    if (!into) {
      installDeps(projectDir)
      initGit(projectDir)
    }

    // Summary
    console.log('')
    console.log('  ✅ Migration complete!')
    console.log('')
    console.log(`  📂 ${projectDir}`)
    console.log(`  📄 ${pagesWritten} pages written to src/content/`)
    console.log('')
    if (!into) {
      console.log('  Next steps:')
      console.log('')
      console.log(`    cd ${rawProjectDir}`)
      console.log('    npm run dev')
      console.log('')
    }

    return { pagesWritten, projectDir }
  } finally {
    // Step 12: Always clean up temp dir
    rmSync(tmpBase, { recursive: true, force: true })
  }
}
