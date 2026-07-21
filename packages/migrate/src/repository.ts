/**
 * Repository adapter for the shared migration engine. Traversal is bounded,
 * symbolic links are ignored, and Git is always invoked with an argument array
 * so source-controlled branch names can never become shell commands.
 */

import { spawn } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { basename, dirname, extname, relative } from 'node:path'

import {
  projectDocusaurusNavigation,
  readDocusaurusSidebars,
  rewriteDocusaurusLinks,
  resolveDocusaurusPageIdentity,
  type DocusaurusPageDescriptor,
  type DocusaurusSidebars,
} from './docusaurus.js'
import { parseMarkdownPage } from './mdx.js'
import {
  buildNavigationFromPages,
  isDocumentationExtension,
  projectMintlifyNavigation,
  readMintlifyConfig,
} from './navigation.js'
import { normalizeAssetPath, pageIdFromReference, resolveWithin } from './path.js'
import type {
  MigrationAsset,
  MigrationBundle,
  MigrationDocsConfig,
  MigrationPage,
  MigrationPlatform,
  MigrationWarning,
} from './types.js'

const MAX_SOURCE_FILES = 5_000
const MAX_PAGE_BYTES = 2_000_000
const MAX_ASSET_BYTES = 25_000_000
const MAX_TOTAL_ASSET_BYTES = 100_000_000
const IGNORED_DIRECTORIES = new Set([
  '.git', '.github', '.next', '.turbo', '.vercel', '.vscode',
  'node_modules', 'dist', 'build', 'coverage',
])
const ASSET_DIRECTORIES = new Set(['assets', 'images', 'img', 'media', 'public', 'static'])
const ASSET_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4',
  '.pdf', '.png', '.svg', '.webm', '.webp',
])
const REPOSITORY_ONLY_DOCUMENTS = new Set([
  'agents.md', 'claude.md', 'code_of_conduct.md', 'contributing.md',
  'license.md', 'readme.md', 'security.md',
])
const SNIPPET_DIRECTORIES = new Set(['snippets', '_snippets', 'partials', '_partials'])
const OPENAPI_FILENAMES = new Set([
  'openapi.json', 'openapi.yaml', 'openapi.yml',
  'swagger.json', 'swagger.yaml', 'swagger.yml',
])

export interface GitHubRepositorySource {
  owner: string
  repo: string
  branch: string
  docsDir: string
  cloneUrl: string
}

export interface RepositoryMigrationOptions {
  repositoryDir: string
  sourceUrl: string
  docsDir?: string
  platform?: MigrationPlatform
}

/** Parse and validate a public GitHub repository URL. */
export function parseGitHubRepositoryUrl(rawUrl: string): GitHubRepositorySource {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid GitHub URL: ${rawUrl}`)
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Repository migrations require an https://github.com URL.')
  }
  if (url.username || url.password || url.port) {
    throw new Error('GitHub repository URLs cannot include credentials or custom ports.')
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const [owner, rawRepo] = segments
  const repo = rawRepo?.replace(/\.git$/i, '')
  const safeName = /^[A-Za-z0-9_.-]+$/
  if (!owner || !repo || !safeName.test(owner) || !safeName.test(repo)) {
    throw new Error('GitHub URL must include a valid owner and repository name.')
  }
  let branch = 'HEAD'
  let docsDir = ''
  if (segments[2] === 'tree' && segments[3]) {
    branch = segments[3]
    docsDir = segments.slice(4).join('/')
  }
  return {
    owner,
    repo,
    branch,
    docsDir,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  }
}

/** Clone a repository without a shell; callers own and remove `targetDir`. */
export async function cloneGitHubRepository(
  source: GitHubRepositorySource,
  targetDir: string,
): Promise<void> {
  const args = ['clone', '--depth', '1', '--single-branch']
  if (source.branch !== 'HEAD') args.push('--branch', source.branch)
  args.push('--', source.cloneUrl, targetDir)
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 16_000) stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Failed to clone ${source.owner}/${source.repo}: ${stderr.trim() || `git exited ${code}`}`))
    })
  })
}

/** Detect a supported repository docs platform from unambiguous config files. */
export function detectRepositoryPlatform(repositoryDir: string): MigrationPlatform {
  if (existsSync(resolveWithin(repositoryDir, 'mint.json'))) return 'mintlify'
  const docsJson = resolveWithin(repositoryDir, 'docs.json')
  if (existsSync(docsJson)) {
    try {
      const config = JSON.parse(readFileSync(docsJson, 'utf8')) as Record<string, unknown>
      if (String(config.$schema ?? '').includes('mintlify') || 'navigation' in config) return 'mintlify'
      if (Array.isArray(config.tabs)) return 'thally'
    } catch {
      // A malformed source config is reported later; platform detection falls through.
    }
  }
  if (['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'docusaurus'
  if (existsSync(resolveWithin(repositoryDir, 'SUMMARY.md'))) return 'gitbook'
  if (existsSync(resolveWithin(repositoryDir, '.vitepress'))) return 'vitepress'
  if (['astro.config.mjs', 'astro.config.ts']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'starlight'
  if (['pages/_meta.json', '_meta.json']
    .some((name) => existsSync(resolveWithin(repositoryDir, name)))) return 'nextra'
  return 'unknown'
}

function containsMarkdown(directory: string, depth = 0): boolean {
  if (depth > 4) return false
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue
    const path = resolveWithin(directory, entry.name)
    if (entry.isFile() && ['.md', '.mdx'].includes(extname(entry.name).toLowerCase())) return true
    if (entry.isDirectory() && containsMarkdown(path, depth + 1)) return true
  }
  return false
}

/** Pick the first conventional content root containing Markdown. */
export function detectRepositoryDocsDir(repositoryDir: string): string {
  for (const candidate of ['docs', 'documentation', 'content', 'pages', 'src/content', 'src/pages', 'guide', 'guides', '']) {
    const path = resolveWithin(repositoryDir, candidate)
    if (existsSync(path) && lstatSync(path).isDirectory() && containsMarkdown(path)) return candidate
  }
  return ''
}

interface ScannedFile {
  absolutePath: string
  relativePath: string
}

function scanFiles(root: string): Array<ScannedFile> {
  const files: Array<ScannedFile> = []
  function visit(directory: string): void {
    if (files.length >= MAX_SOURCE_FILES) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= MAX_SOURCE_FILES) return
      if (IGNORED_DIRECTORIES.has(entry.name) || entry.isSymbolicLink()) continue
      const path = resolveWithin(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push({ absolutePath: path, relativePath: relative(root, path).replace(/\\/g, '/') })
    }
  }
  visit(root)
  return files
}

function normalizedReferenceKey(value: string): string {
  return value.split(/[?#]/, 1)[0]
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\.(?:mdx?|rst|txt)$/i, '')
    .replace(/\/(?:index|readme)$/i, '')
    .replace(/^(?:index|readme)$/i, '') || 'introduction'
}

function findOpenApi(files: Array<ScannedFile>): ScannedFile | null {
  return files.find((file) => OPENAPI_FILENAMES.has(basename(file.relativePath).toLowerCase())) ?? null
}

function withoutFrontmatter(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

function inlineMdxSnippets(
  raw: string,
  currentFile: string,
  repositoryRoot: string,
  warnings: Array<MigrationWarning>,
  depth = 0,
): string {
  if (depth >= 8) return raw
  const snippets = new Map<string, string>()
  const withoutImports = raw.replace(
    /^import\s+([A-Z][A-Za-z0-9_]*)\s+from\s+['"]([^'"]+\.mdx?)['"]\s*;?\s*$/gm,
    (_statement, componentName: string, sourcePath: string) => {
      try {
        const candidate = sourcePath.startsWith('/')
          ? resolveWithin(repositoryRoot, sourcePath.replace(/^\/+/, ''))
          : resolveWithin(dirname(currentFile), sourcePath)
        // Prove a relative import resolved under the repository, not merely
        // under the current directory's parent chain.
        resolveWithin(repositoryRoot, relative(repositoryRoot, candidate))
        if (!existsSync(candidate) || !lstatSync(candidate).isFile()) throw new Error('file not found')
        const nested = inlineMdxSnippets(
          withoutFrontmatter(readFileSync(candidate, 'utf8')),
          candidate,
          repositoryRoot,
          warnings,
          depth + 1,
        )
        snippets.set(componentName, nested)
        return ''
      } catch {
        warnings.push({
          code: 'missing-page',
          message: `Imported snippet ${sourcePath} could not be resolved and was left as a comment.`,
          source: relative(repositoryRoot, currentFile).replace(/\\/g, '/'),
        })
        snippets.set(componentName, `{/* Missing imported snippet: ${sourcePath} */}`)
        return ''
      }
    },
  )
  let result = withoutImports
  for (const [componentName, snippet] of snippets) {
    result = result
      .replace(new RegExp(`<${componentName}(?:\\s[^>]*)?\\s*/>`, 'g'), snippet)
      .replace(new RegExp(`<${componentName}(?:\\s[^>]*)?>(?:[\\s\\S]*?)<\\/${componentName}>`, 'g'), snippet)
  }
  return result
}

function injectOpenApi(config: MigrationDocsConfig, filename: string): MigrationDocsConfig {
  const tabs = config.tabs.filter((tab) => !tab.tab.toLowerCase().includes('api'))
  const apiTab: MigrationDocsConfig['tabs'][number] = {
    tab: 'API Reference',
    api: { source: `/${filename}` },
  }
  const changelog = tabs.findIndex((tab) => tab.tab.toLowerCase() === 'changelog')
  if (changelog >= 0) tabs.splice(changelog, 0, apiTab)
  else tabs.push(apiTab)
  return { ...config, tabs }
}

/** Import an already-available repository directory into a canonical bundle. */
export function migrateRepository(options: RepositoryMigrationOptions): MigrationBundle {
  const repositoryDir = options.repositoryDir
  const platform = options.platform ?? detectRepositoryPlatform(repositoryDir)
  const warnings: Array<MigrationWarning> = []
  let docsConfig: MigrationDocsConfig = { tabs: [] }
  const referenceMap = new Map<string, { navigationId: string; locale?: string }>()
  const referenceOrder = new Map<string, number>()
  let docusaurusSidebars: DocusaurusSidebars | null = null

  if (platform === 'mintlify') {
    try {
      const config = readMintlifyConfig(repositoryDir)
      if (config) {
        const projected = projectMintlifyNavigation(config)
        docsConfig = projected.docsConfig
        warnings.push(...projected.warnings)
        for (const [index, reference] of projected.pageReferences.entries()) {
          const key = normalizedReferenceKey(reference.ref)
          referenceMap.set(key, reference)
          referenceOrder.set(key, index)
        }
      }
    } catch (error) {
      warnings.push({
        code: 'unsupported-config',
        message: `Mintlify config could not be read: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  if (platform === 'docusaurus') {
    try {
      docusaurusSidebars = readDocusaurusSidebars(repositoryDir)
    } catch (error) {
      warnings.push({
        code: 'unsupported-config',
        message: `Docusaurus sidebar could not be read safely: ${error instanceof Error ? error.message : String(error)} Generated navigation will be used.`,
      })
    }
  }

  const configuredDocsDir = options.docsDir ?? (platform === 'mintlify' ? '' : detectRepositoryDocsDir(repositoryDir))
  const contentRoot = resolveWithin(repositoryDir, configuredDocsDir)
  if (!existsSync(contentRoot) || !lstatSync(contentRoot).isDirectory()) {
    throw new Error(`Documentation directory does not exist: ${configuredDocsDir || '.'}`)
  }
  const files = scanFiles(contentRoot)
  const pages: Array<MigrationPage> = []
  const assets: Array<MigrationAsset> = []
  const docusaurusDescriptors: Array<DocusaurusPageDescriptor> = []
  const seenPageIds = new Set<string>()
  let skipped = 0

  const localeConfig = docsConfig.i18n
  const pageFiles = [...files].sort((left, right) => {
    const leftOrder = referenceOrder.get(normalizedReferenceKey(left.relativePath)) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = referenceOrder.get(normalizedReferenceKey(right.relativePath)) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.relativePath.localeCompare(right.relativePath)
  })
  for (const file of pageFiles) {
    if (!isDocumentationExtension(file.relativePath)) continue
    if (file.relativePath.split('/').some((segment) => SNIPPET_DIRECTORIES.has(segment.toLowerCase()))) {
      skipped++
      continue
    }
    const rootFilename = !file.relativePath.includes('/') ? basename(file.relativePath).toLowerCase() : ''
    if (!configuredDocsDir && REPOSITORY_ONLY_DOCUMENTS.has(rootFilename)) {
      skipped++
      continue
    }
    if (!['.md', '.mdx'].includes(extname(file.relativePath).toLowerCase())) {
      skipped++
      warnings.push({ code: 'skipped-file', message: 'Only Markdown and MDX are imported without an explicit converter.', source: file.relativePath })
      continue
    }
    const size = lstatSync(file.absolutePath).size
    if (size > MAX_PAGE_BYTES) {
      skipped++
      warnings.push({ code: 'skipped-file', message: 'Page exceeded the 2 MB repository import limit.', source: file.relativePath })
      continue
    }
    const key = normalizedReferenceKey(file.relativePath)
    const referenced = referenceMap.get(key)
    let locale = referenced?.locale
    let navigationId = referenced?.navigationId ?? pageIdFromReference(file.relativePath)
    if (!referenced && localeConfig) {
      const prefix = file.relativePath.split('/', 1)[0]
      if (localeConfig.locales.some((entry) => entry.code === prefix)) {
        locale = prefix
        navigationId = pageIdFromReference(file.relativePath.slice(prefix.length + 1))
      }
    }
    if (!navigationId) {
      skipped++
      warnings.push({ code: 'invalid-page', message: 'Page path could not be normalized safely.', source: file.relativePath })
      continue
    }
    const isDefaultLocale = !locale || locale === localeConfig?.defaultLocale
    const id = isDefaultLocale ? navigationId : `${locale}/${navigationId}`
    const raw = inlineMdxSnippets(
      readFileSync(file.absolutePath, 'utf8'),
      file.absolutePath,
      repositoryDir,
      warnings,
    )
    let docusaurusDescriptor: Omit<DocusaurusPageDescriptor, 'title'> | undefined
    const page = parseMarkdownPage({
      id,
      navigationId,
      ...(locale ? { locale } : {}),
      raw,
      source: `${options.sourceUrl}#${file.relativePath}`,
      ...(platform === 'docusaurus' ? {
        resolveIdentity: (frontmatter, fallback) => {
          const resolved = resolveDocusaurusPageIdentity(file.relativePath, frontmatter, fallback)
          docusaurusDescriptor = resolved.descriptor
          return resolved.identity
        },
      } : {}),
    })
    if (!page) {
      skipped++
      continue
    }
    if (seenPageIds.has(page.id)) {
      skipped++
      warnings.push({ code: 'collision', message: `Multiple source files map to ${page.id}; the first file was kept.`, source: file.relativePath })
      continue
    }
    seenPageIds.add(page.id)
    pages.push(page)
    if (docusaurusDescriptor) {
      docusaurusDescriptors.push({ ...docusaurusDescriptor, title: page.title })
    }
  }

  const discoveredReferenceKeys = new Set(files.map((file) => normalizedReferenceKey(file.relativePath)))
  for (const [key] of referenceMap) {
    if (!discoveredReferenceKeys.has(key)) {
      warnings.push({ code: 'missing-page', message: 'A navigation entry did not resolve to a source page.', source: key })
    }
  }

  const repositoryAssets = platform === 'docusaurus' && configuredDocsDir
    ? ['static', 'public'].flatMap((directory) => {
        const root = resolveWithin(repositoryDir, directory)
        if (!existsSync(root) || !lstatSync(root).isDirectory()) return []
        return scanFiles(root).map((file) => ({
          ...file,
          relativePath: `${directory}/${file.relativePath}`,
        }))
      })
    : []
  let totalAssetBytes = 0
  for (const file of [...files, ...repositoryAssets]) {
    const firstSegment = file.relativePath.split('/', 1)[0].toLowerCase()
    if (!ASSET_DIRECTORIES.has(firstSegment) || !ASSET_EXTENSIONS.has(extname(file.relativePath).toLowerCase())) continue
    const size = lstatSync(file.absolutePath).size
    if (size > MAX_ASSET_BYTES || totalAssetBytes + size > MAX_TOTAL_ASSET_BYTES) {
      warnings.push({ code: 'limit-reached', message: 'An asset was skipped because the migration asset budget was exhausted.', source: file.relativePath })
      continue
    }
    const isDocusaurusStatic = platform === 'docusaurus' && firstSegment === 'static'
    const assetPath = normalizeAssetPath(firstSegment === 'public'
      ? file.relativePath.slice('public/'.length)
      : isDocusaurusStatic
        ? file.relativePath.slice('static/'.length)
        : file.relativePath)
    if (!assetPath) continue
    assets.push({ path: assetPath, content: readFileSync(file.absolutePath) })
    totalAssetBytes += size
  }

  if (files.length >= MAX_SOURCE_FILES) {
    warnings.push({ code: 'limit-reached', message: `Repository discovery stopped at ${MAX_SOURCE_FILES} files.` })
  }
  if (platform === 'docusaurus') {
    const projected = projectDocusaurusNavigation({
      sidebars: docusaurusSidebars,
      descriptors: docusaurusDescriptors,
      contentRoot,
      sourceUrl: options.sourceUrl,
    })
    docsConfig = projected.docsConfig
    warnings.push(...projected.warnings)
    for (const page of projected.generatedPages) {
      if (seenPageIds.has(page.id)) continue
      seenPageIds.add(page.id)
      pages.push(page)
    }
    const descriptorByNavigationId = new Map(
      docusaurusDescriptors.map((descriptor) => [descriptor.navigationId, descriptor]),
    )
    for (const page of pages) {
      const descriptor = descriptorByNavigationId.get(page.navigationId)
      if (descriptor) page.body = rewriteDocusaurusLinks(page.body, descriptor, docusaurusDescriptors)
    }
  }
  if (docsConfig.tabs.length === 0) docsConfig = buildNavigationFromPages(pages)
  const openApi = findOpenApi(files)
  if (openApi) {
    const filename = basename(openApi.relativePath)
    if (!assets.some((asset) => asset.path === filename)) {
      assets.push({ path: filename, content: readFileSync(openApi.absolutePath) })
    }
    docsConfig = injectOpenApi(docsConfig, filename)
  }

  if (pages.length === 0) throw new Error('No importable Markdown or MDX pages were found in the repository.')
  return {
    sourceUrl: options.sourceUrl,
    sourceKind: 'repository',
    platform,
    pages,
    assets,
    docsConfig,
    warnings,
    stats: { discovered: files.length, imported: pages.length, skipped },
  }
}
