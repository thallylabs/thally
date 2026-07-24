/** Interactive prompt contracts for new projects and source migrations. */

import { input, select } from '@inquirer/prompts'
import { basename, resolve } from 'node:path'

import type { MigrationPlatform } from '@thallylabs/migrate'

export type SelectableMigrationPlatform = Extract<MigrationPlatform, 'mintlify' | 'docusaurus'>

/** Validate the scriptable platform flag while preserving auto-detection. */
export function parseMigrationPlatform(value: string | undefined): SelectableMigrationPlatform | undefined {
  if (!value || value === 'auto') return undefined
  if (value === 'mintlify' || value === 'docusaurus') return value
  throw new Error('--platform must be mintlify, docusaurus, or auto.')
}

/** Ask interactive migrations which source adapter should own the import. */
export async function gatherMigrationPlatform(
  value: string | undefined,
  useDefaults: boolean,
): Promise<SelectableMigrationPlatform | undefined> {
  const configured = parseMigrationPlatform(value)
  if (configured || value === 'auto' || useDefaults) return configured
  return select({
    message: '  Which platform currently hosts these docs?',
    choices: [
      { name: 'Mintlify', value: 'mintlify' as const },
      { name: 'Docusaurus', value: 'docusaurus' as const },
      { name: 'Other / detect automatically', value: undefined },
    ],
    default: 'mintlify',
  })
}

export interface ScaffoldAnswers {
  projectDir: string
  projectName: string
  description: string
  brandPreset: string
  repoUrl: string
  doInstall: boolean
  i18nLocales?: Array<{ code: string; label: string }>
  /** Repos to pre-register for Thally Track (opt-in during setup); undefined = off. */
  trackRepos?: Array<{ owner: string; repo: string }>
}

export async function gatherAnswers(
  dirArg: string | undefined,
  useDefaults: boolean,
  installPreference?: boolean,
): Promise<ScaffoldAnswers> {
  // 1. Project directory
  let projectDir: string
  if (dirArg) {
    projectDir = resolve(dirArg)
  } else if (useDefaults) {
    projectDir = resolve('my-docs')
  } else {
    const dirName = await input({
      message: '  Project directory:',
      default: 'my-docs',
    })
    projectDir = resolve(dirName)
  }

  // 2. Project name
  const defaultName = basename(projectDir)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

  const projectName = useDefaults
    ? defaultName
    : await input({
        message: '  Project name:',
        default: defaultName,
      })

  // 3. Description
  const defaultDesc = `Documentation for ${projectName}.`
  const description = useDefaults
    ? defaultDesc
    : await input({
        message: '  Description:',
        default: defaultDesc,
      })

  // 4. Brand preset
  const brandPreset = useDefaults
    ? 'primary'
    : await select({
        message: '  Brand preset:',
        choices: [
          { name: 'primary', value: 'primary' },
          { name: 'secondary', value: 'secondary' },
        ],
        default: 'primary',
      })

  // 5. GitHub repo (optional)
  const repoUrl = useDefaults
    ? ''
    : await input({
        message: '  GitHub repo URL (optional):',
        default: '',
      })

  // 6. Thally Track (opt-in) — keep docs in sync with code automatically.
  let trackRepos: Array<{ owner: string; repo: string }> | undefined
  if (!useDefaults) {
    const enableTrack = await input({
      message:
        '  Keep your docs in sync automatically with Thally Track? When a PR merges in a repo you list,\n  the docs agent drafts the doc updates as a PR for you to review. (y/N):',
      default: 'N',
    })
    if (enableTrack.trim().toLowerCase() === 'y') {
      const reposInput = await input({
        message: '  Which repo(s) should Thally watch? (comma-separated owner/repo, e.g. acme/api,acme/web):',
        default: '',
      })
      const parsed = reposInput
        .split(',')
        .map((spec) => spec.trim().match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => ({ owner: m[1], repo: m[2] }))
      if (parsed.length > 0) trackRepos = parsed
      else console.log('  ⚠ No valid owner/repo entries — skipping Track (add it later with `thally track add`).')
    }
  }

  // 7. Install deps?
  let doInstall = installPreference ?? false
  if (!useDefaults && installPreference === undefined) {
    const shouldInstall = await input({
      message: '  Install dependencies now? (y/N):',
      default: 'N',
    })
    doInstall = shouldInstall.trim().toLowerCase().startsWith('y')
  }

  // 8. Multi-language support?
  let i18nLocales: Array<{ code: string; label: string }> | undefined
  if (!useDefaults) {
    const enableI18n = await input({
      message: '  Enable multi-language support? (y/N):',
      default: 'N',
    })
    if (enableI18n.toLowerCase() === 'y') {
      const localesInput = await input({
        message: '  Which locales? (comma-separated codes, e.g. es,fr,de):',
        default: 'es',
      })
      const LOCALE_LABELS: Record<string, string> = {
        en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch',
        it: 'Italiano', pt: 'Português', ja: '日本語', ko: '한국어',
        zh: '中文', ru: 'Русский', ar: 'العربية', nl: 'Nederlands',
      }
      const codes = localesInput.split(',').map((c) => c.trim()).filter(Boolean)
      i18nLocales = codes.map((code) => ({
        code,
        label: LOCALE_LABELS[code] ?? code.toUpperCase(),
      }))
    }
  }

  return { projectDir, projectName, description, brandPreset, repoUrl, doInstall, i18nLocales, trackRepos }
}
